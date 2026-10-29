// OledFaultSync: which "display" commands go to Node 3 for the demo faults
// the ECUs were commanded, and what happens after each result. Display only;
// detection is never involved.
import { describe, expect, it } from 'vitest';

import { OledFaultSync, isDisplayCommand } from '../src/lib/serial/oled-sync';

const texts = (s: OledFaultSync) => s.take().map((u) => u.text);

describe('OledFaultSync', () => {
  it('sends nothing before Node 3 has said hello', () => {
    const s = new OledFaultSync();
    s.onEcuAck('node1', 'fault bad_checksum');
    expect(s.take()).toEqual([]);
    s.onMonitorHello('cafe0001');
    expect(s.take()).toEqual([{ node: 'node1', fault: 'bad_checksum', text: 'display fault node1 bad_checksum' }]);
  });

  it('shows a fault on Node 1, on Node 2, on both, and clears each ECU separately', () => {
    const s = new OledFaultSync();
    s.onMonitorHello('cafe0001');
    s.onEcuAck('node1', 'fault heartbeat_stop');
    expect(texts(s)).toEqual(['display fault node1 heartbeat_stop']);
    s.onEcuAck('node2', 'fault heartbeat_stop');
    expect(texts(s)).toEqual(['display fault node2 heartbeat_stop']);
    expect(texts(s)).toEqual([]);  // sent once
    s.onEcuState('node1', 'heartbeat_stop');  // periodic self-report: no repeat
    s.onEcuAck('node2', 'fault heartbeat_stop');  // duplicate inject: no repeat
    expect(texts(s)).toEqual([]);
    s.onEcuAck('node1', 'fault clear');
    expect(texts(s)).toEqual(['display clear node1']);  // Node 2 untouched
    s.onEcuAck('node2', 'fault clear');
    expect(texts(s)).toEqual(['display clear node2']);
  });

  it('follows the ECU self-report, e.g. after the ECU restarted', () => {
    const s = new OledFaultSync();
    s.onMonitorHello('cafe0001');
    s.onEcuAck('node1', 'fault heartbeat_stop');
    s.take();
    s.onEcuState('node1', 'none');
    expect(texts(s)).toEqual(['display clear node1']);
  });

  it('resends the current state to a restarted Node 3 and clears stale state on first contact', () => {
    const s = new OledFaultSync();
    s.onEcuState('node1', 'none');
    s.onEcuState('node2', 'bad_version');
    s.onMonitorHello('cafe0001');
    expect(texts(s)).toEqual(['display clear node1', 'display fault node2 bad_version']);
    s.onMonitorHello('cafe0001');  // periodic hello, same boot
    expect(texts(s)).toEqual([]);
    s.onMonitorHello('cafe0002');
    expect(texts(s)).toEqual(['display clear node1', 'display fault node2 bad_version']);
  });

  it('retries after a timeout or a lost link at the next hello, but not after unsupported or rejected', () => {
    const s = new OledFaultSync();
    s.onMonitorHello('cafe0001');
    s.onEcuAck('node1', 'fault bad_dlc');
    const [u] = s.take();
    s.onResult(u, 'timeout');
    expect(s.take()).toEqual([]);  // not every event
    s.onMonitorHello('cafe0001');
    const [again] = s.take();
    expect(again.text).toBe('display fault node1 bad_dlc');
    s.onResult(again, 'unsupported');
    s.onMonitorHello('cafe0001');
    expect(s.take()).toEqual([]);  // an old firmware is not asked again on this boot
    s.onEcuAck('node1', 'fault silent');  // a new value is sent (and reported) again
    const [next] = s.take();
    expect(next.text).toBe('display fault node1 silent');
    s.onResult(next, 'rejected');
    s.onMonitorHello('cafe0001');
    expect(s.take()).toEqual([]);
    s.onResult(next, 'ok');
    expect(s.take()).toEqual([]);
  });

  it('after Node 3 was disconnected, resends everything once it says hello again', () => {
    const s = new OledFaultSync();
    s.onMonitorHello('cafe0001');
    s.onEcuAck('node1', 'fault bad_dlc');
    s.onEcuAck('node2', 'fault silent');
    s.take();
    s.onMonitorLost();
    s.onEcuAck('node2', 'fault clear');
    expect(s.take()).toEqual([]);
    expect(s.takeUnsendable().map((u) => u.text)).toEqual(['display clear node2']);
    expect(s.takeUnsendable()).toEqual([]);  // reported once
    s.onMonitorHello('cafe0001');  // same boot: it still shows the old state
    expect(texts(s)).toEqual(['display fault node1 bad_dlc', 'display clear node2']);
  });

  it('reports only user commands as unsendable, not periodic self-reports', () => {
    const s = new OledFaultSync();
    s.onEcuState('node1', 'none');
    s.onEcuState('node2', 'silent');
    expect(s.takeUnsendable()).toEqual([]);
    s.onEcuAck('node1', 'fault heartbeat_stop');
    expect(s.takeUnsendable().map((u) => u.text)).toEqual(['display fault node1 heartbeat_stop']);
  });

  it('ignores other commands and unknown fault names', () => {
    const s = new OledFaultSync();
    s.onMonitorHello('cafe0001');
    s.onEcuAck('node1', 'set rpm 3000');
    s.onEcuAck('node1', 'fault explode');
    s.onEcuState('node1', 'bad dlc; rm');
    expect(s.take()).toEqual([]);
    expect(s.takeUnsendable()).toEqual([]);
  });

  it('recognises display commands', () => {
    expect(isDisplayCommand('display fault node1 silent')).toBe(true);
    expect(isDisplayCommand('display clear')).toBe(true);
    expect(isDisplayCommand('displayx')).toBe(false);
    expect(isDisplayCommand('fault silent')).toBe(false);
  });
});
