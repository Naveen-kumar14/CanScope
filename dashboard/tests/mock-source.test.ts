import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionState } from '../src/lib/data-source';
import { MockCanDataSource, scenarioFromUrl, type MockScenario } from '../src/mock-data/mock-source';
import type { CanScopeEvent } from '../src/types/events';

function run(scenario: MockScenario, ms: number) {
  const events: CanScopeEvent[] = [];
  const states: ConnectionState[] = [];
  const src = new MockCanDataSource({ scenario, tickMs: 100, connectDelayMs: 50 });
  src.connect({ onEvent: (e) => events.push(e), onConnectionChange: (s) => states.push(s) });
  vi.advanceTimersByTime(ms);
  src.disconnect();
  return { events, states, src };
}

describe('MockCanDataSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is a read-only mock source', () => {
    const src = new MockCanDataSource();
    expect(src.kind).toBe('mock');
    // The data boundary exposes no way to send anything.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(src))).not.toEqual(
      expect.arrayContaining(['send', 'transmit', 'write', 'command']),
    );
  });

  it('normal: connects and emits mock frames + node3 status', () => {
    const { events, states } = run('normal', 2000);
    expect(states).toEqual(['connecting', 'connected']);
    expect(events.length).toBeGreaterThan(10);
    expect(events.every((e) => e.origin === 'mock')).toBe(true);
    const frames = events.filter((e) => e.type === 'frame');
    expect(frames.some((e) => e.canId === '0x7A0')).toBe(true);
    expect(frames.every((e) => e.verified === false)).toBe(true);
    const node3 = events.find((e) => e.type === 'status' && e.sourceNode === 'node3');
    expect(node3).toMatchObject({ configStatus: 'UNVERIFIED', driverRunning: false, txEnabled: false });
  });

  it('empty: status only, no frames', () => {
    const { events } = run('empty', 2000);
    expect(events.some((e) => e.type === 'frame')).toBe(false);
    expect(events.some((e) => e.type === 'status')).toBe(true);
  });

  it('error / disconnected / stale scenarios', () => {
    expect(run('error', 1000).states).toEqual(['connecting', 'error']);
    expect(run('disconnected', 2000).states).toEqual(['connecting', 'connected', 'disconnected']);
    const stale = run('stale', 3000);
    expect(stale.states).toEqual(['connecting', 'connected']);
    const count = stale.events.length;
    expect(count).toBeGreaterThan(0);
  });

  it('bus_off scenario reports bus-off', () => {
    const { events } = run('bus_off', 2000);
    expect(events.some((e) => e.type === 'status' && e.busState === 'bus_off' && e.busOffEvents === 1)).toBe(true);
  });

  it('reads the scenario from the URL', () => {
    expect(scenarioFromUrl('?scenario=stale')).toBe('stale');
    expect(scenarioFromUrl('?scenario=bogus')).toBe('normal');
  });
});
