// Plain-language CAN link diagnosis from what the boards report about
// themselves (status lines) and what Node 3 observes. Pure, so it is tested.
//
// "USB connected" only proves the serial link. CAN works only when frames are
// acknowledged on the bus and Node 3 receives them, so the findings below are
// derived from controller counters, never from USB state alone. Nothing here
// invents data: with no report the finding says the state is unknown.

import type { DeviceNode, EcuNode, NodeStatusEvent, TransceiverCheck } from '../types/events';
import { nodeLabel } from './protocol';

export type FindingTone = 'ok' | 'info' | 'warn' | 'bad';

export interface Finding {
  id: string;
  tone: FindingTone;
  title: string;
  detail: string;
  /** Concrete next actions, in order. */
  steps: string[];
}

export interface BusDiagnosisInput {
  /** false in mock mode: nothing physical to diagnose. */
  physical: boolean;
  /** USB serial link open and identified, per board. */
  usb: Record<DeviceNode, boolean>;
  /** Latest status line per board (only boards whose USB link is open count). */
  status: Partial<Record<DeviceNode, NodeStatusEvent>>;
  /** Frames per second Node 3 reported in the last second. */
  frameRate: number;
}

const ECUS: EcuNode[] = ['node1', 'node2'];
const DEVICES: DeviceNode[] = ['node1', 'node2', 'monitor'];

/** Dashboard copy of firmware transceiver_check_hint(). */
export const TRANSCEIVER_CHECK_TEXT: Record<TransceiverCheck, { label: string; hint: string }> = {
  not_run: { label: 'not run', hint: 'Not run: listen-only mode never drives the bus.' },
  ok: {
    label: 'passed',
    hint: 'RX follows TX: transceiver powered, driver enabled, TX→D and R→RX wired. CANH/CANL wiring and termination are not tested by this check.',
  },
  rx_not_driven: {
    label: 'RX not driven',
    hint: 'Nothing drives the ESP32 RX pin: R→GPIO16 wire open or on the wrong pin, transceiver without 3.3 V/GND, or TX and RX swapped.',
  },
  rx_stuck_dominant: {
    label: 'RX stuck dominant',
    hint: 'RX always reads dominant: CANH and CANL shorted, another node holding the bus, a faulty transceiver, or RX wired to a low signal.',
  },
  no_echo: {
    label: 'no echo',
    hint: 'RX does not follow TX: Rs pin high or floating (standby — tie Rs to GND), TX→D wire open or on the wrong pin, or TX and RX swapped.',
  },
  inconsistent: {
    label: 'inconsistent',
    hint: 'RX follows TX only sometimes: loose breadboard contact, noise, or heavy bus traffic. Press EN on the board to repeat the check.',
  },
};

const WIRING_STEPS = [
  'Unplug every board before touching wires.',
  'On each SN65HVD230 module: 3V3 to the ESP32 3V3 pin, GND to GND, Rs (if broken out) to GND.',
  'Transceiver D input (often labelled CTX or TX) to GPIO17; transceiver R output (CRX or RX) to GPIO16 — on all three boards.',
  'With power off, check continuity CANH↔CANH and CANL↔CANL between all three modules, and that CANH is not connected to CANL.',
  'Power up and read each board’s transceiver echo check on the Diagnostics tab.',
];

function noAck(s: NodeStatusEvent | undefined): boolean {
  if (!s || !s.driverRunning) return false;
  return s.txFailed > 0 || s.busState === 'error_warning' || s.busState === 'error_passive';
}

export function diagnoseBus(input: BusDiagnosisInput): Finding[] {
  if (!input.physical) {
    return [
      {
        id: 'mock',
        tone: 'info',
        title: 'Mock data: no hardware to diagnose',
        detail: 'Switch the data source to Physical to diagnose the real boards.',
        steps: [],
      },
    ];
  }

  const findings: Finding[] = [];
  const status = (n: DeviceNode) => (input.usb[n] ? input.status[n] : undefined);
  const connected = DEVICES.filter((n) => input.usb[n]);

  if (connected.length === 0) {
    return [
      {
        id: 'no-usb',
        tone: 'info',
        title: 'No board connected',
        detail: 'Connect the three ESP32 boards over USB to see their state.',
        steps: ['Open the Connections tab and press “Add serial port…” once for each board.'],
      },
    ];
  }

  for (const n of DEVICES) {
    const s = status(n);
    if (!s) continue;
    if (!s.driverRunning && s.busState !== 'bus_off') {
      findings.push({
        id: `driver-${n}`,
        tone: 'bad',
        title: `${nodeLabel(n)}: CAN controller not running`,
        detail: 'The board’s TWAI controller did not start, so it cannot send or receive frames.',
        steps: ['Open that board’s port card on the Connections tab and read the “CAN init” diagnostic line.'],
      });
    }
    if (s.transceiverCheck && s.transceiverCheck !== 'ok' && s.transceiverCheck !== 'not_run') {
      const t = TRANSCEIVER_CHECK_TEXT[s.transceiverCheck];
      findings.push({
        id: `xcvr-${n}`,
        tone: 'bad',
        title: `${nodeLabel(n)}: transceiver echo check ${t.label}`,
        detail: t.hint,
        steps: ['Unplug the board, fix the wiring named above, plug it in again (the check runs at every start).'],
      });
    }
    if (s.busState === 'bus_off') {
      findings.push({
        id: `busoff-${n}`,
        tone: 'bad',
        title: `${nodeLabel(n)}: controller is bus-off`,
        detail: 'It stopped taking part in the bus after too many errors. Recovery is never automatic.',
        steps: ['Fix the cause with power off (wiring, terminators, bit rate).', 'Then use “Recover from bus-off” on the Fault testing tab.'],
      });
    }
  }

  const monitor = status('monitor');
  const ecusNoAck = ECUS.filter((n) => noAck(status(n)));
  if (ecusNoAck.length > 0) {
    const who = ecusNoAck.map(nodeLabel).join(' and ');
    const monitorRx = monitor ? monitor.rxFrames : null;
    findings.push({
      id: 'no-ack',
      tone: 'bad',
      title: 'Frames are not acknowledged on the CAN bus',
      detail:
        `${who} ${ecusNoAck.length > 1 ? 'are' : 'is'} transmitting, but no other node acknowledges the frames ` +
        `(transmit failures or error-passive state)` +
        (monitorRx === null ? '. Node 3 is not connected, so its receive count is unknown.' : `, and Node 3 has received ${monitorRx} frame(s).`) +
        ' The USB links work; the CAN wiring between the transceivers does not.' +
        (ecusNoAck.length === 2 ? ' Node 1 and Node 2 cannot hear each other either, so the fault is common to the bus, not only Node 3.' : ''),
      steps: WIRING_STEPS,
    });
  } else if (monitor && monitor.driverRunning && monitor.rxFrames === 0 && ECUS.some((n) => (status(n)?.txFrames ?? 0) > 16)) {
    findings.push({
      id: 'monitor-deaf',
      tone: 'bad',
      title: 'Node 3 receives nothing although the ECUs transmit without errors',
      detail: 'Another node acknowledges the ECU frames, so the bus works, but Node 3’s receive path does not.',
      steps: [
        'Check Node 3’s transceiver R output (CRX) goes to Node 3 GPIO16.',
        'Check Node 3’s CANH/CANL stub reaches the trunk.',
        'Read Node 3’s transceiver echo check on the Diagnostics tab.',
      ],
    });
  }

  if (monitor && monitor.rxMissed > 0) {
    findings.push({
      id: 'rx-missed',
      tone: 'warn',
      title: `Node 3 dropped ${monitor.rxMissed} frame(s)`,
      detail: 'Its receive queue overflowed, usually because the USB link could not keep up with raw frame output.',
      steps: ['Send “Raw frames off” to Node 3 on the Fault testing tab; telemetry and faults continue.'],
    });
  }

  if (!input.usb.monitor) {
    findings.push({
      id: 'no-monitor',
      tone: 'info',
      title: 'Node 3 is not connected: CAN traffic is unknown',
      detail: 'Only Node 3 reports what is actually on the bus. Without it nothing can be said about received frames or faults.',
      steps: ['Connect Node 3 on the Connections tab.'],
    });
  } else if (monitor === undefined) {
    findings.push({
      id: 'monitor-waiting',
      tone: 'info',
      title: 'Waiting for Node 3’s first status report',
      detail: 'Status lines arrive once per second.',
      steps: [],
    });
  } else if (findings.every((f) => f.tone !== 'bad') && monitor.rxFrames > 0 && input.frameRate > 0) {
    findings.unshift({
      id: 'healthy',
      tone: 'ok',
      title: `CAN bus operational: Node 3 is receiving ${Math.round(input.frameRate)} frames/s`,
      detail: 'Frames are acknowledged and reach the monitor. Faults below come from Node 3’s own checks.',
      steps: [],
    });
  } else if (findings.every((f) => f.tone !== 'bad') && input.frameRate === 0) {
    findings.push({
      id: 'no-traffic',
      tone: 'warn',
      title: 'No CAN traffic received',
      detail:
        connected.includes('node1') || connected.includes('node2')
          ? 'Node 3 is running but no frame has arrived in the last second.'
          : 'Node 3 is running but no frame has arrived. Connect Node 1 and Node 2 to see whether they transmit.',
      steps: ['Power the ECUs and check that their status shows the controller running.'],
    });
  }

  const rank: Record<FindingTone, number> = { bad: 0, warn: 1, info: 2, ok: 3 };
  return findings.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
