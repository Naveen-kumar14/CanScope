// Pure dashboard state: reducer + derived selectors (no React, easy to test).

import type { ConnectionState } from './data-source';
import type { BusState, CanScopeEvent, DataOrigin, NodeStatusEvent, StoredFrame } from '../types/events';

export const MAX_FRAMES = 1000;
export const STALE_AFTER_MS = 3000;
export const FRAME_RATE_WINDOW_MS = 1000;

export interface NodeHealth {
  node: string;
  lastSeenMs: number;
  framesReported: number;
  status: NodeStatusEvent | null;
}

export interface DashboardState {
  sourceKind: DataOrigin;
  sourceLabel: string;
  connection: ConnectionState;
  connectionDetail: string | null;
  frames: StoredFrame[]; // oldest first, capped at MAX_FRAMES
  nextSeq: number;
  droppedFromView: number; // frames evicted from the in-memory buffer
  nodes: Record<string, NodeHealth>;
  lastEventMs: number | null;
}

export type DashboardAction =
  | { type: 'connection'; state: ConnectionState; detail?: string }
  | { type: 'event'; event: CanScopeEvent; receivedAtMs: number }
  | { type: 'reset'; sourceKind: DataOrigin; sourceLabel: string };

export function initialState(sourceKind: DataOrigin, sourceLabel: string): DashboardState {
  return {
    sourceKind,
    sourceLabel,
    connection: 'idle',
    connectionDetail: null,
    frames: [],
    nextSeq: 1,
    droppedFromView: 0,
    nodes: {},
    lastEventMs: null,
  };
}

export function reducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'reset':
      return initialState(action.sourceKind, action.sourceLabel);
    case 'connection':
      return { ...state, connection: action.state, connectionDetail: action.detail ?? null };
    case 'event': {
      const { event, receivedAtMs } = action;
      const prev = state.nodes[event.sourceNode];
      const node: NodeHealth = {
        node: event.sourceNode,
        lastSeenMs: receivedAtMs,
        framesReported: (prev?.framesReported ?? 0) + (event.type === 'frame' ? 1 : 0),
        status: event.type === 'status' ? event : (prev?.status ?? null),
      };
      const nodes = { ...state.nodes, [event.sourceNode]: node };
      if (event.type === 'status') {
        return { ...state, nodes, lastEventMs: receivedAtMs };
      }
      const stored: StoredFrame = { ...event, seq: state.nextSeq, receivedAtMs };
      let frames = [...state.frames, stored];
      let dropped = state.droppedFromView;
      if (frames.length > MAX_FRAMES) {
        dropped += frames.length - MAX_FRAMES;
        frames = frames.slice(frames.length - MAX_FRAMES);
      }
      return {
        ...state,
        frames,
        nextSeq: state.nextSeq + 1,
        droppedFromView: dropped,
        nodes,
        lastEventMs: receivedAtMs,
      };
    }
  }
}

export type ViewState = 'loading' | 'error' | 'disconnected' | 'idle' | 'empty' | 'stale' | 'live';

export function viewState(state: DashboardState, nowMs: number): ViewState {
  switch (state.connection) {
    case 'idle': return 'idle';
    case 'connecting': return 'loading';
    case 'error': return 'error';
    case 'disconnected': return 'disconnected';
    case 'connected': break;
  }
  if (state.lastEventMs !== null && nowMs - state.lastEventMs > STALE_AFTER_MS) return 'stale';
  if (state.frames.length === 0) return 'empty';
  return 'live';
}

export function frameRate(frames: readonly StoredFrame[], nowMs: number): number {
  let n = 0;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (nowMs - frames[i].receivedAtMs > FRAME_RATE_WINDOW_MS) break;
    n++;
  }
  return (n * 1000) / FRAME_RATE_WINDOW_MS;
}

const SEVERITY: Record<BusState, number> = {
  unknown: 0,
  error_active: 1,
  stopped: 2,
  error_warning: 3,
  recovering: 4,
  error_passive: 5,
  bus_off: 6,
};

/** Worst bus state reported by any node whose CAN driver is configured. */
export function overallBusState(nodes: Record<string, NodeHealth>): BusState {
  let worst: BusState = 'unknown';
  for (const n of Object.values(nodes)) {
    const s = n.status;
    if (!s || (s.busState === 'stopped' && !s.driverRunning && s.bitrate === 0)) continue;
    if (SEVERITY[s.busState] > SEVERITY[worst]) worst = s.busState;
  }
  return worst;
}

export interface Counters {
  rx: number;
  tx: number;
  errors: number;
  busOff: number;
  rxMissed: number;
}

export function totalCounters(nodes: Record<string, NodeHealth>): Counters {
  const c: Counters = { rx: 0, tx: 0, errors: 0, busOff: 0, rxMissed: 0 };
  for (const n of Object.values(nodes)) {
    if (!n.status) continue;
    c.rx += n.status.rxFrames;
    c.tx += n.status.txFrames;
    c.errors += n.status.busErrors;
    c.busOff += n.status.busOffEvents;
    c.rxMissed += n.status.rxMissed;
  }
  return c;
}

export function isNodeStale(node: NodeHealth, nowMs: number): boolean {
  return nowMs - node.lastSeenMs > STALE_AFTER_MS;
}
