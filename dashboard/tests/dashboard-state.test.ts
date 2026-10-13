import { describe, expect, it } from 'vitest';

import {
  MAX_FRAMES,
  STALE_AFTER_MS,
  frameRate,
  initialState,
  overallBusState,
  reducer,
  totalCounters,
  viewState,
  type DashboardState,
} from '../src/lib/dashboard-state';
import { DEFAULT_FILTER, filterFrames } from '../src/lib/filters';
import { frame, status } from './helpers';

const connected = (): DashboardState =>
  reducer(initialState('mock', 'test'), { type: 'connection', state: 'connected' });

describe('dashboard state', () => {
  it('derives view states', () => {
    let s = initialState('mock', 'test');
    expect(viewState(s, 0)).toBe('idle');
    s = reducer(s, { type: 'connection', state: 'connecting' });
    expect(viewState(s, 0)).toBe('loading');
    s = reducer(s, { type: 'connection', state: 'connected' });
    expect(viewState(s, 0)).toBe('empty');
    s = reducer(s, { type: 'event', event: frame(), receivedAtMs: 1000 });
    expect(viewState(s, 1500)).toBe('live');
    expect(viewState(s, 1000 + STALE_AFTER_MS + 1)).toBe('stale');
    expect(viewState(reducer(s, { type: 'connection', state: 'disconnected' }), 1500)).toBe('disconnected');
    expect(viewState(reducer(s, { type: 'connection', state: 'error', detail: 'x' }), 1500)).toBe('error');
  });

  it('keeps every frame (including unknown IDs) up to the buffer cap', () => {
    let s = connected();
    for (let i = 0; i < MAX_FRAMES + 5; i++) {
      s = reducer(s, { type: 'event', event: frame({ canId: '0x123' }), receivedAtMs: i });
    }
    expect(s.frames).toHaveLength(MAX_FRAMES);
    expect(s.droppedFromView).toBe(5);
    expect(s.frames[0].seq).toBe(6);
  });

  it('tracks node health from frames and status', () => {
    let s = connected();
    s = reducer(s, { type: 'event', event: frame({ sourceNode: 'node1' }), receivedAtMs: 10 });
    s = reducer(s, { type: 'event', event: status({ sourceNode: 'node3', driverRunning: false, busState: 'stopped', bitrate: 0, configStatus: 'UNVERIFIED' }), receivedAtMs: 20 });
    expect(s.nodes.node1.framesReported).toBe(1);
    expect(s.nodes.node3.status?.configStatus).toBe('UNVERIFIED');
    expect(s.frames).toHaveLength(1); // status events are not frames
  });

  it('computes frame rate, worst bus state and counters', () => {
    let s = connected();
    for (let i = 0; i < 5; i++) s = reducer(s, { type: 'event', event: frame(), receivedAtMs: 1000 + i * 100 });
    expect(frameRate(s.frames, 1500)).toBe(5);
    expect(frameRate(s.frames, 5000)).toBe(0);

    s = reducer(s, { type: 'event', event: status({ sourceNode: 'monitor', rxFrames: 7 }), receivedAtMs: 1 });
    s = reducer(s, { type: 'event', event: status({ sourceNode: 'node1', busState: 'bus_off', busOffEvents: 1, busErrors: 3 }), receivedAtMs: 1 });
    // Node with an unconfigured driver does not count towards bus state.
    s = reducer(s, { type: 'event', event: status({ sourceNode: 'node3', busState: 'stopped', driverRunning: false, bitrate: 0 }), receivedAtMs: 1 });
    expect(overallBusState(s.nodes)).toBe('bus_off');
    expect(totalCounters(s.nodes)).toMatchObject({ rx: 27, busOff: 1, errors: 3 });
    expect(overallBusState({})).toBe('unknown');
  });

  it('filters by ID, node and time range', () => {
    let s = connected();
    s = reducer(s, { type: 'event', event: frame({ canId: '0x201', sourceNode: 'monitor' }), receivedAtMs: 0 });
    s = reducer(s, { type: 'event', event: frame({ canId: '0x7A0', sourceNode: 'node1' }), receivedAtMs: 55_000 });
    const now = 60_000;
    expect(filterFrames(s.frames, DEFAULT_FILTER, now)).toHaveLength(2);
    expect(filterFrames(s.frames, { ...DEFAULT_FILTER, canId: '0x201' }, now).map((f) => f.canId)).toEqual(['0x201']);
    expect(filterFrames(s.frames, { ...DEFAULT_FILTER, canId: '7a' }, now).map((f) => f.canId)).toEqual(['0x7A0']);
    expect(filterFrames(s.frames, { ...DEFAULT_FILTER, node: 'node1' }, now)).toHaveLength(1);
    expect(filterFrames(s.frames, { ...DEFAULT_FILTER, timeRange: '10s' }, now).map((f) => f.canId)).toEqual(['0x7A0']);
  });
});
