// Physical-mode page behaviour with an in-memory Web Serial double.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PhysicalSource } from '../src/lib/serial/physical-source';
import { DashboardPage } from '../src/pages/DashboardPage';
import { FakePort, FakeSerialApi, LINES, settle } from './fake-serial';

const ECU_STATE_FAULT =
  '{"type":"ecu_state","sourceNode":"node1","deviceTimeUs":4,"bootId":"deadbeef","role":"motor_ecu","canRunning":true,"busState":"error_active","profile":"static","demoFault":"heartbeat_stop","setpoint":{"rpm":1500,"motorTempC":65.0},"sent":{"rpm":1500,"motorTempC":65.0},"telemetryFrames":10,"heartbeatFrames":2,"txOk":12,"txFailed":0,"rxIgnored":0}';
const FAULTS_NONE =
  '{"type":"faults","sourceNode":"monitor","deviceTimeUs":3,"bootId":"cafe0001","lastEventId":0,"count":0,"active":[],"truncated":false}';
const STATUS_MONITOR =
  '{"type":"status","sourceNode":"monitor","deviceTimeUs":1,"busState":"error_active","driverRunning":true,"mode":"normal","txEnabled":false,"bitrate":500000,"configStatus":"WORKING_ASSUMPTION","txErrorCount":0,"rxErrorCount":0,"rxFrames":5,"txFrames":0,"txFailed":0,"rxMissed":0,"busErrors":0,"arbitrationLost":0,"busOffEvents":0}';

async function setup() {
  window.history.replaceState(null, '', '/');  // the selected tab lives in the URL hash
  const api = new FakeSerialApi();
  const source = new PhysicalSource(api, { tickMs: 1e9 });
  render(<DashboardPage source={source} physical={source} flushMs={0} />);
  const add = async (port: FakePort) => {
    api.nextPick = port;
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-port'));
      await settle();
    });
  };
  const emit = async (port: FakePort, ...lines: string[]) => {
    await act(async () => {
      port.emit(lines.map((l) => `${l}\n`).join(''));
      await settle();
      source.tick();
    });
  };
  return { api, source, add, emit };
}

const openTab = (id: string) => fireEvent.click(screen.getByTestId(`tab-${id}`));

describe('DashboardPage in physical mode', () => {
  it('starts idle with every node unconnected and every control disabled, never showing mock data', async () => {
    await setup();
    expect(screen.getByTestId('data-origin')).toHaveTextContent('PHYSICAL');
    expect(screen.queryByTestId('mock-banner')).toBeNull();
    expect(screen.getByTestId('state-idle')).toBeInTheDocument();
    expect(screen.getByTestId('observed-node1-unavailable')).toHaveTextContent('Node 3 (monitor) is not connected');
    expect(screen.getByTestId('faults-unavailable')).toHaveTextContent('fault detection status is unknown');
    expect(screen.getByTestId('status-traffic')).toHaveTextContent('Unknown — Node 3 not connected');
    expect(screen.queryByText('CAN link check')).toBeNull();  // section removed from the Overview
    expect(screen.queryByTestId('finding-no-usb')).toBeNull();
    openTab('faults');
    for (const n of ['node1', 'node2', 'monitor']) {
      expect(screen.getByTestId(`offline-${n}`)).toBeInTheDocument();
      const card = screen.getByTestId(`controls-${n}`);
      for (const b of within(card).getAllByRole('button')) expect(b).toBeDisabled();
    }
  });

  it('enables a node only after its port identifies, and validates locally before sending', async () => {
    const t = await setup();
    const port = new FakePort();
    await t.add(port);
    await t.emit(port, LINES.helloNode1);
    expect(screen.getByTestId('expected-node1')).toHaveTextContent('on CP210x 10C4:EA60');
    expect(screen.getByTestId('send-node1-rpm')).toBeEnabled();
    expect(screen.getByTestId('send-node2-voltage')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('node1 rpm'), { target: { value: '9000' } });
    fireEvent.click(screen.getByTestId('send-node1-rpm'));
    expect(screen.getByTestId('error-node1-rpm')).toHaveTextContent('Not sent: out of range 0..8000 rpm');
    expect(port.written).toEqual([]);

    fireEvent.change(screen.getByLabelText('node1 rpm'), { target: { value: '3000' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('send-node1-rpm'));
      await settle();
    });
    expect(port.lines()).toHaveLength(1);
    const [id, ...rest] = port.lines()[0].slice(1).split(' ');
    expect(rest.join(' ')).toBe('set rpm 3000');
    expect(screen.getByTestId(`cmd-state-${id}`)).toHaveTextContent('waiting for ack');
    await t.emit(port, LINES.ack('node1', id, 'ok', 'set rpm 3000', 'rpm=3000'));
    expect(screen.getByTestId(`cmd-state-${id}`)).toHaveTextContent('acknowledged');
  });

  it('shows example frames apart from real data while Node 3 has received none, and replaces them with real frames', async () => {
    const t = await setup();
    const mon = new FakePort();
    await t.add(mon);
    await t.emit(mon, LINES.helloMonitor, STATUS_MONITOR.replace('"rxFrames":5', '"rxFrames":0'), FAULTS_NONE);
    openTab('traffic');
    const examples = screen.getByTestId('example-frames');
    expect(within(examples).getByTestId('example-frames-note')).toHaveTextContent('Not received from the bus');
    for (const id of ['0x120', '0x220', '0x701', '0x702']) expect(within(examples).getByTestId(`example-${id}`)).toBeInTheDocument();
    // Kept out of the real data: no real frame table, RX count 0, nothing sent, no fault.
    expect(screen.queryByTestId('frame-table')).toBeNull();
    expect(screen.getByTestId('frames-none')).toHaveTextContent('No frames received.');
    expect(screen.getByTestId('frames-intro')).toHaveTextContent('None has been received yet');
    expect(screen.getByTestId('counter-rx')).toHaveTextContent('0');
    expect(mon.written).toEqual([]);
    openTab('faults');
    openTab('overview');
    expect(screen.getByTestId('faults-none')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/demo/i);

    // A real frame from Node 3: the examples disappear and the real row shows with its verdict.
    await t.emit(
      mon,
      '{"type":"frame","sourceNode":"monitor","deviceTimeUs":12,"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":8,"data":[0,0,0,0,0,0,0,222],"busState":"error_active","txErrorCount":0,"rxErrorCount":0,"kind":"motor_telemetry","check":"ok","accepted":true}',
    );
    openTab('traffic');
    expect(screen.queryByTestId('example-frames')).toBeNull();
    const table = screen.getByTestId('frame-table');
    expect(within(table).getByText('0x120')).toBeInTheDocument();
    expect(within(table).getByText('accepted')).toBeInTheDocument();
  });

  it('CAN controllers table: shorter normal-state wording, no echo or pin columns, real states kept', async () => {
    const t = await setup();
    const [n1, mon] = [new FakePort(), new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 })];
    await t.add(n1);
    await t.add(mon);
    await t.emit(mon, LINES.helloMonitor, STATUS_MONITOR);
    await t.emit(
      n1,
      LINES.helloNode1,
      STATUS_MONITOR.replace('"sourceNode":"monitor"', '"sourceNode":"node1"').replace('"busState":"error_active"', '"busState":"bus_off"'),
    );
    openTab('diagnostics');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).not.toContain('Transceiver echo');
    expect(headers).not.toContain('Pin config');
    expect(screen.getByTestId('node-monitor')).toHaveTextContent('Active (normal)');
    expect(screen.getByTestId('node-monitor')).not.toHaveTextContent('Error active');
    // A genuine bus-off is still reported as bus-off.
    expect(screen.getByTestId('node-node1')).toHaveTextContent('BUS-OFF');
    for (const row of [screen.getByTestId('node-monitor'), screen.getByTestId('node-node1')]) {
      expect(within(row).getAllByRole('cell')).toHaveLength(headers.length - 1);  // + the row header
    }
  });

  it('logs the OLED display command after an injection, with its result only from Node 3', async () => {
    const t = await setup();
    const ecu = new FakePort();
    const mon = new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    await t.add(ecu);
    await t.add(mon);
    await t.emit(ecu, LINES.helloNode1);
    await t.emit(mon, LINES.helloMonitor);
    openTab('faults');
    fireEvent.change(screen.getByLabelText('node1 fault to inject'), { target: { value: 'heartbeat_stop' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('inject-node1'));
      await settle();
    });
    const faultId = ecu.lines()[0].slice(1).split(' ')[0];
    await t.emit(ecu, LINES.ack('node1', faultId, 'ok', 'fault heartbeat_stop', 'demoFault=heartbeat_stop'));
    expect(mon.lines()).toHaveLength(1);
    const displayId = mon.lines()[0].slice(1).split(' ')[0];
    const row = () => screen.getByTestId(`cmd-${displayId}`);
    expect(row()).toHaveTextContent('display fault node1 heartbeat_stop');
    expect(screen.getByTestId(`cmd-state-${displayId}`)).toHaveTextContent('waiting for ack');
    expect(screen.getByTestId(`cmd-detail-${displayId}`)).toHaveTextContent('waiting for acknowledgement');  // nothing claimed yet

    // An old Node 3 firmware without the command.
    await t.emit(mon, LINES.ack('monitor', displayId, 'unsupported', 'display fault node1 heartbeat_stop', 'unsupported command (try help)', 'cafe0001'));
    expect(screen.getByTestId(`cmd-state-${displayId}`)).toHaveTextContent('unsupported');
    expect(screen.getByTestId(`cmd-detail-${displayId}`)).toHaveTextContent(/^unsupported command \(try help\)$/);  // the actual reason

    // Reflashed Node 3 (new boot): the state is sent again and confirmed by its ack.
    await t.emit(mon, LINES.helloMonitor.replace('cafe0001', 'cafe0002'));
    const againId = mon.lines()[1].slice(1).split(' ')[0];
    await t.emit(mon, LINES.ack('monitor', againId, 'ok', 'display fault node1 heartbeat_stop', 'OLED: commanded fault shown (display only, not a detection)', 'cafe0002'));
    expect(screen.getByTestId(`cmd-detail-${againId}`)).toHaveTextContent(/^OLED updated$/);
    expect(screen.getByTestId('command-log')).not.toHaveTextContent(/display only|not a detection/);
    // The OLED ack is not a detection: the requested fault is still undetected.
    await t.emit(ecu, ECU_STATE_FAULT);
    await t.emit(mon, STATUS_MONITOR.replace('"deviceTimeUs":1', '"deviceTimeUs":2'), FAULTS_NONE.replace('cafe0001', 'cafe0002'));
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('not detected (yet)');

    // Clearing: the ECU acks, then Node 3 acks the display clear.
    await act(async () => {
      fireEvent.click(screen.getByTestId('clear-node1'));
      await settle();
    });
    const clearId = ecu.lines().at(-1)!.slice(1).split(' ')[0];
    await t.emit(ecu, LINES.ack('node1', clearId, 'ok', 'fault clear', 'demoFault=none'));
    expect(mon.lines().at(-1)).toMatch(/^@\S+ display clear node1$/);
    const displayClearId = mon.lines().at(-1)!.slice(1).split(' ')[0];
    await t.emit(mon, LINES.ack('monitor', displayClearId, 'ok', 'display clear node1', 'OLED: commanded fault cleared (display only)', 'cafe0002'));
    expect(screen.getByTestId(`cmd-detail-${displayClearId}`)).toHaveTextContent(/^OLED cleared$/);
    expect(screen.getByTestId('command-log')).not.toHaveTextContent(/display only|not a detection/);
  });

  it('shows a commanded demo fault as not detected until Node 3 independently reports it', async () => {
    const t = await setup();
    const ecu = new FakePort();
    const mon = new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    await t.add(ecu);
    await t.add(mon);
    await t.emit(ecu, LINES.helloNode1, ECU_STATE_FAULT);
    expect(screen.getByTestId('commanded-node1')).toHaveTextContent('heartbeat_stop');
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('unknown — Node 3 not connected');

    await t.emit(mon, LINES.helloMonitor, STATUS_MONITOR);
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('not detected (yet)');
    // No fault list yet: never a premature "no faults".
    expect(screen.getByTestId('faults-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('status-faults')).toHaveTextContent('Waiting for Node 3’s fault list');
    await t.emit(mon, FAULTS_NONE);
    expect(screen.getByTestId('faults-none')).toBeInTheDocument();
    expect(screen.getByTestId('status-faults')).toHaveTextContent('None active');

    await t.emit(mon, LINES.fault(1, 'HEARTBEAT_LOST', 'node1', 'active'));
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('detected by Node 3');
    expect(screen.getByTestId('fault-HEARTBEAT_LOST-node1')).toHaveTextContent('critical');

    await t.emit(mon, LINES.fault(2, 'HEARTBEAT_LOST', 'node1', 'cleared'));
    expect(screen.queryByTestId('fault-HEARTBEAT_LOST-node1')).toBeNull();
    expect(within(screen.getByTestId('fault-history')).getByText('recovered')).toBeInTheDocument();
  });

  it('shows serial-port contention as an error with the reason', async () => {
    const t = await setup();
    const port = new FakePort();
    const busy = new Error('Failed to open serial port.');
    busy.name = 'NetworkError';
    port.openError = busy;
    await t.add(port);
    expect(screen.getByTestId('state-error')).toHaveTextContent('port busy or unavailable');
  });

  it('forgets unidentified port cards individually while the three nodes stay connected', async () => {
    const t = await setup();
    const nodes = [new FakePort(), new FakePort(), new FakePort()];
    const strays = [new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 }), new FakePort()];
    const busy = new Error('Failed to open serial port.');
    busy.name = 'NetworkError';
    strays[1].openError = busy;
    for (const p of [...nodes, ...strays]) await t.add(p);
    await t.emit(nodes[0], LINES.helloNode1);
    await t.emit(nodes[1], LINES.helloNode2);
    await t.emit(nodes[2], LINES.helloMonitor);

    expect(screen.getAllByText('Unidentified port')).toHaveLength(2);
    // Identified node cards never offer Forget.
    const ids = t.source.getSnapshot().links.map((l) => l.id);
    for (const id of ids.slice(0, 3)) expect(screen.queryByTestId(`forget-${id}`)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`forget-${ids[3]}`));
      await settle();
    });
    expect(screen.queryByTestId(`link-${ids[3]}`)).toBeNull();
    expect(strays[0].readable).toBeNull();
    expect(screen.getAllByText('Unidentified port')).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId(`forget-${ids[4]}`));
      await settle();
    });
    expect(screen.queryByText('Unidentified port')).toBeNull();
    for (const n of ['node1', 'node2', 'monitor']) expect(screen.getByTestId(`expected-${n}`)).toHaveTextContent('on ');
    expect(screen.getByTestId('send-node1-rpm')).toBeEnabled();
  });

  it('reports the missing Web Serial API instead of falling back to mock data', () => {
    const source = new PhysicalSource(null);
    render(<DashboardPage source={source} physical={source} flushMs={0} />);
    expect(screen.getByTestId('serial-unsupported')).toHaveTextContent('nothing is simulated');
    expect(screen.getByTestId('state-error')).toHaveTextContent('Web Serial is not available');
    expect(screen.queryByTestId('mock-banner')).toBeNull();
  });

  it('separates USB from CAN: all ports open but no frame acknowledged is reported as a CAN wiring fault', async () => {
    const t = await setup();
    const [n1, n2, mon] = [new FakePort(), new FakePort(), new FakePort()];
    for (const p of [n1, n2, mon]) await t.add(p);
    const ecuStatus = (node: string) =>
      STATUS_MONITOR.replace('"sourceNode":"monitor"', `"sourceNode":"${node}"`)
        .replace('"busState":"error_active"', '"busState":"error_passive"')
        .replace('"txEnabled":false', '"txEnabled":true')
        .replace('"txErrorCount":0', '"txErrorCount":128')
        .replace('"rxFrames":5', '"rxFrames":0')
        .replace('"txFrames":0', '"txFrames":8')
        .replace('"txFailed":0', '"txFailed":42');
    await t.emit(n1, LINES.helloNode1, ecuStatus('node1'));
    await t.emit(n2, LINES.helloNode2, ecuStatus('node2'));
    await t.emit(mon, LINES.helloMonitor, STATUS_MONITOR.replace('"rxFrames":5', '"rxFrames":0'));

    expect(screen.getByTestId('status-usb')).toHaveTextContent('3 of 3 connected');
    expect(screen.getByTestId('status-traffic')).toHaveTextContent('No CAN traffic received');
    expect(screen.getByTestId('status-bus')).toHaveTextContent('Error passive');
    // The CAN link check section is gone from the Overview, with all of its cards.
    expect(screen.queryByText('CAN link check')).toBeNull();
    expect(screen.queryByTestId('finding-no-ack')).toBeNull();
    expect(screen.queryByTestId('finding-healthy')).toBeNull();
    expect(screen.getByTestId('connection-status')).toHaveTextContent('USB: 3 of 3 boards');
  });

  it('when Node 3 is unplugged, the fault list becomes unknown and a requested fault is not shown as detected', async () => {
    const t = await setup();
    const ecu = new FakePort();
    const mon = new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    await t.add(ecu);
    await t.add(mon);
    await t.emit(ecu, LINES.helloNode1, ECU_STATE_FAULT);
    await t.emit(mon, LINES.helloMonitor, STATUS_MONITOR, LINES.fault(1, 'HEARTBEAT_LOST', 'node1', 'active'));
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('detected by Node 3');

    await act(async () => {
      mon.unplug();
      t.api.fire('disconnect', mon);
      await settle();
    });
    expect(screen.queryByTestId('faults-none')).toBeNull();
    expect(screen.getByTestId('faults-unavailable')).toHaveTextContent('fault detection status is unknown');
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('unknown — Node 3 not connected');
    expect(screen.getByTestId('status-faults')).toHaveTextContent('Unknown');
  });

  it('supports keyboard navigation between tabs', async () => {
    await setup();
    const overview = screen.getByTestId('tab-overview');
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('tab-traffic')).toHaveAttribute('tabindex', '-1');
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(screen.getByTestId('tab-traffic')).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByTestId('tab-traffic'));
    fireEvent.keyDown(screen.getByTestId('tab-traffic'), { key: 'End' });
    expect(screen.getByTestId('tab-diagnostics')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-diagnostics');
    fireEvent.keyDown(screen.getByTestId('tab-diagnostics'), { key: 'ArrowRight' });
    expect(screen.getByTestId('tab-overview')).toHaveAttribute('aria-selected', 'true');
  });

  it('tells the user whether forgetting a port revoked the browser permission', async () => {
    const t = await setup();
    const stray = new FakePort();
    await t.add(stray);
    const id = t.source.getSnapshot().links[0].id;
    await act(async () => {
      fireEvent.click(screen.getByTestId(`forget-${id}`));
      await settle();
    });
    expect(screen.getByTestId('forget-notice')).toHaveTextContent('Removed and serial permission revoked.');
  });
});
