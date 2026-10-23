// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { diagnoseBus, type BusDiagnosisInput } from '../src/lib/bus-diagnosis';
import type { NodeStatusEvent } from '../src/types/events';
import { status } from './helpers';

const ALL_USB = { node1: true, node2: true, monitor: true };
const ecu = (overrides: Partial<NodeStatusEvent> = {}) =>
  status({ sourceNode: 'node1', mode: 'normal', txEnabled: true, rxFrames: 0, ...overrides });

function input(overrides: Partial<BusDiagnosisInput> = {}): BusDiagnosisInput {
  return { physical: true, usb: ALL_USB, status: {}, frameRate: 0, ...overrides };
}
const ids = (i: BusDiagnosisInput) => diagnoseBus(i).map((f) => f.id);

describe('diagnoseBus', () => {
  it('does not diagnose mock data, and asks for boards when nothing is connected', () => {
    expect(ids(input({ physical: false }))).toEqual(['mock']);
    expect(ids(input({ usb: { node1: false, node2: false, monitor: false } }))).toEqual(['no-usb']);
  });

  it('reports the bench failure: USB open, ECU transmit failures, monitor receives nothing', () => {
    // The reported symptom: all three ports open, commands acked, monitor RX 0,
    // ECU txFailed rising, ECUs error passive.
    const findings = diagnoseBus(
      input({
        status: {
          node1: ecu({ busState: 'error_passive', txErrorCount: 128, txFrames: 8, txFailed: 120 }),
          node2: ecu({ sourceNode: 'node2', busState: 'error_passive', txErrorCount: 128, txFrames: 8, txFailed: 95 }),
          monitor: status({ mode: 'normal', rxFrames: 0 }),
        },
      }),
    );
    expect(findings[0]).toMatchObject({ id: 'no-ack', tone: 'bad', title: 'Frames are not acknowledged on the CAN bus' });
    expect(findings[0].detail).toMatch(/Node 3 has received 0 frame/);
    expect(findings[0].detail).toMatch(/cannot hear each other/);
    expect(findings[0].detail).toMatch(/USB links work/);
    expect(findings[0].steps.join(' ')).toMatch(/GPIO17/);
    // Never claims the bus is healthy.
    expect(findings.map((f) => f.id)).not.toContain('healthy');
  });

  it('names the failing board from its transceiver echo check', () => {
    const findings = diagnoseBus(input({ status: { node2: ecu({ sourceNode: 'node2', transceiverCheck: 'no_echo' }), monitor: status() } }));
    const f = findings.find((x) => x.id === 'xcvr-node2')!;
    expect(f.title).toBe('Node 2 - Battery ECU: transceiver echo check no echo');
    expect(f.detail).toMatch(/Rs pin high or floating/);
  });

  it('does not treat a passed echo check or an old firmware without it as a finding', () => {
    const list = ids(input({ status: { node1: ecu({ transceiverCheck: 'ok' }), node2: ecu({ sourceNode: 'node2' }), monitor: status() } }));
    expect(list.filter((x) => x.startsWith('xcvr'))).toEqual([]);
  });

  it('points at Node 3 when the ECUs are acknowledged but Node 3 receives nothing', () => {
    expect(
      ids(input({ status: { node1: ecu({ txFrames: 500 }), node2: ecu({ sourceNode: 'node2', txFrames: 500 }), monitor: status({ rxFrames: 0 }) } })),
    ).toContain('monitor-deaf');
  });

  it('says traffic is unknown, not absent, when Node 3 is not connected', () => {
    const list = diagnoseBus(input({ usb: { node1: true, node2: true, monitor: false }, status: { node1: ecu({ txFrames: 50 }) } }));
    expect(list.map((f) => f.id)).toEqual(['no-monitor']);
  });

  it('reports a healthy bus only with frames actually arriving at Node 3', () => {
    const healthy = input({ status: { node1: ecu({ txFrames: 50 }), node2: ecu({ sourceNode: 'node2', txFrames: 50 }), monitor: status({ rxFrames: 120 }) } });
    expect(ids({ ...healthy, frameRate: 24 })).toEqual(['healthy']);
    expect(ids({ ...healthy, frameRate: 0 })).toEqual(['no-traffic']);
  });

  it('reports bus-off, a stopped controller and dropped frames', () => {
    const list = ids(
      input({
        status: {
          node1: ecu({ busState: 'bus_off', driverRunning: false }),
          node2: ecu({ sourceNode: 'node2', busState: 'stopped', driverRunning: false }),
          monitor: status({ rxFrames: 10, rxMissed: 4 }),
        },
        frameRate: 10,
      }),
    );
    expect(list).toEqual(expect.arrayContaining(['busoff-node1', 'driver-node2', 'rx-missed']));
    expect(list).not.toContain('driver-node1');  // bus-off is reported once, as bus-off
    expect(list).not.toContain('healthy');
  });
});
