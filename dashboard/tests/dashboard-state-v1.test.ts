// @vitest-environment node
// Reducer handling of Node 3 faults (ordering, replays, snapshots, restarts)
// and the observed-vs-self-reported telemetry rule.
import { describe, expect, it } from 'vitest';

import { initialState, reducer, telemetryView, TELEMETRY_STALE_MS, type DashboardState } from '../src/lib/dashboard-state';
import type { CanScopeEvent } from '../src/types/events';

const base = { timestamp: '', origin: 'live' as const, sourceNode: 'monitor' };

const fault = (eventId: number, code: string, state: 'active' | 'cleared', bootId = 'b1'): CanScopeEvent => ({
  ...base,
  type: 'fault',
  bootId,
  eventId,
  code,
  node: 'node1',
  severity: 'critical',
  state,
  detail: '',
});

const snapshot = (lastEventId: number, codes: string[], bootId = 'b1'): CanScopeEvent => ({
  ...base,
  type: 'faults',
  bootId,
  lastEventId,
  count: codes.length,
  truncated: false,
  active: codes.map((code) => ({ code, node: 'node1', severity: 'critical', ageMs: 100, detail: '' })),
});

const monitorStatus: CanScopeEvent = {
  ...base,
  type: 'status',
  busState: 'error_active',
  driverRunning: true,
  mode: 'normal',
  txEnabled: false,
  bitrate: 500000,
  configStatus: 'WORKING_ASSUMPTION',
  txErrorCount: 0,
  rxErrorCount: 0,
  rxFrames: 0,
  txFrames: 0,
  txFailed: 0,
  rxMissed: 0,
  busErrors: 0,
  arbitrationLost: 0,
  busOffEvents: 0,
};

function run(events: CanScopeEvent[], start: DashboardState = initialState('live', 'x'), t0 = 1000): DashboardState {
  return reducer(start, { type: 'events', items: events.map((event, i) => ({ event, receivedAtMs: t0 + i })) });
}

describe('observed faults and telemetry (protocol v1)', () => {
  it('applies raise/clear in order, ignores replays and stale snapshots', () => {
    let s = run([fault(1, 'HEARTBEAT_LOST', 'active'), fault(2, 'TELEMETRY_STALE', 'active')]);
    expect(s.activeFaults.map((f) => f.code)).toEqual(['HEARTBEAT_LOST', 'TELEMETRY_STALE']);
    s = run([fault(1, 'HEARTBEAT_LOST', 'active'), snapshot(1, ['HEARTBEAT_LOST'])], s); // replay + older snapshot
    expect(s.activeFaults).toHaveLength(2);
    expect(s.faultHistory).toHaveLength(2);
    s = run([fault(3, 'HEARTBEAT_LOST', 'cleared')], s);
    expect(s.activeFaults.map((f) => f.code)).toEqual(['TELEMETRY_STALE']);
    expect(s.faultHistory.map((h) => h.state)).toEqual(['cleared', 'active', 'active']);
    s = run([snapshot(3, [])], s); // authoritative, current snapshot
    expect(s.activeFaults).toHaveLength(0);
  });

  it('a snapshot gives a late-joining dashboard the active faults with their age', () => {
    const s = run([snapshot(9, ['BUS_SILENT'])]);
    expect(s.activeFaults[0]).toMatchObject({ code: 'BUS_SILENT', sinceMs: 900 });
  });

  it('a monitor restart discards faults from the old boot', () => {
    let s = run([fault(5, 'HEARTBEAT_LOST', 'active')]);
    s = run([fault(1, 'TELEMETRY_STALE', 'active', 'b2')], s);
    expect(s.activeFaults.map((f) => f.code)).toEqual(['TELEMETRY_STALE']);
    expect(s.faultHistory.some((h) => h.code === 'MONITOR_RESTARTED')).toBe(true);
  });

  it('telemetry is unavailable without the monitor and never taken from the ECU self-report', () => {
    const ecu: CanScopeEvent = {
      ...base,
      sourceNode: 'node1',
      type: 'ecu_state',
      bootId: 'x',
      role: 'motor_ecu',
      canRunning: true,
      busState: 'error_active',
      profile: 'static',
      demoFault: 'none',
      setpoint: { rpm: 3000 },
      sent: { rpm: 3000 },
      telemetryFrames: 1,
      heartbeatFrames: 1,
      txOk: 1,
      txFailed: 0,
      rxIgnored: 0,
    };
    let s = run([ecu]);
    expect(s.ecuStates.node1?.event.setpoint.rpm).toBe(3000);
    expect(telemetryView(s, 'node1', 2000).kind).toBe('unavailable');

    const tel: CanScopeEvent = {
      ...base,
      type: 'telemetry',
      node: 'node1',
      valid: true,
      ageMs: 40,
      counter: 3,
      state: 'ok',
      values: { rpm: 1500 },
    };
    s = run([monitorStatus, tel], s, 1000); // telemetry received at 1001
    const v = telemetryView(s, 'node1', 1101);
    expect(v).toMatchObject({ kind: 'current', ageMs: 140 });
    if (v.kind !== 'unavailable') expect(v.event.values.rpm).toBe(1500); // observed, not the setpoint
    expect(telemetryView(s, 'node1', 1001 + TELEMETRY_STALE_MS + 1).kind).toBe('stale');
    s = run([{ ...tel, state: 'lost' }], s, 1200);
    expect(telemetryView(s, 'node1', 1205)).toMatchObject({ kind: 'stale', reason: 'Node 3 reports telemetry lost' });
  });
});
