// Pure dashboard state: reducer + derived selectors (no React, easy to test).
//
// Two kinds of information are kept strictly apart:
// - OBSERVED: what Node 3 (the monitor) reports from CAN frames it actually
//   received: telemetry, node_health, fault events and fault snapshots.
// - SELF-REPORTED: what an ECU says about itself over its own USB port
//   (ecu_state: commanded setpoints, demo fault). Never shown as observed.

import type { ConnectionState } from './data-source';
import type {
  ActiveFault,
  BusState,
  CanScopeEvent,
  DataOrigin,
  DeviceNode,
  EcuNode,
  EcuStateEvent,
  FaultEvent,
  FaultSeverity,
  HelloEvent,
  NodeHealthEvent,
  NodeStatusEvent,
  SelftestEvent,
  StoredFrame,
  TelemetryEvent,
} from '../types/events';

export const MAX_FRAMES = 1000;
export const MAX_FAULT_HISTORY = 200;
export const STALE_AFTER_MS = 3000;
/** Observed telemetry with no update for this long is shown as stale. */
export const TELEMETRY_STALE_MS = 1500;
export const FRAME_RATE_WINDOW_MS = 1000;

export interface NodeHealth {
  node: string;
  lastSeenMs: number;
  framesReported: number;
  status: NodeStatusEvent | null;
}

export interface Received<T> {
  event: T;
  receivedAtMs: number;
}

export interface ActiveFaultEntry {
  code: string;
  node: DeviceNode;
  severity: FaultSeverity;
  detail: string;
  /** Host time the fault became active (receive time minus reported age). */
  sinceMs: number;
}

export interface FaultHistoryEntry {
  key: string;  // bootId:eventId
  code: string;
  node: DeviceNode;
  severity: FaultSeverity;
  state: 'active' | 'cleared';
  detail: string;
  atMs: number;
  deviceTimeUs?: number;
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
  // Observed by Node 3:
  telemetry: Partial<Record<EcuNode, Received<TelemetryEvent>>>;
  health: Partial<Record<EcuNode, Received<NodeHealthEvent>>>;
  activeFaults: ActiveFaultEntry[];
  faultHistory: FaultHistoryEntry[];
  monitorBootId: string | null;
  lastFaultEventId: number;
  lastSnapshotMs: number | null;
  snapshotTruncated: boolean;
  selftest: SelftestEvent | null;
  // Self-reported by each device:
  ecuStates: Partial<Record<EcuNode, Received<EcuStateEvent>>>;
  hellos: Partial<Record<DeviceNode, Received<HelloEvent>>>;
}

export type DashboardAction =
  | { type: 'connection'; state: ConnectionState; detail?: string }
  | { type: 'event'; event: CanScopeEvent; receivedAtMs: number }
  | { type: 'events'; items: { event: CanScopeEvent; receivedAtMs: number }[] }
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
    telemetry: {},
    health: {},
    activeFaults: [],
    faultHistory: [],
    monitorBootId: null,
    lastFaultEventId: 0,
    lastSnapshotMs: null,
    snapshotTruncated: false,
    selftest: null,
    ecuStates: {},
    hellos: {},
  };
}

export function reducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'reset':
      return initialState(action.sourceKind, action.sourceLabel);
    case 'connection':
      return { ...state, connection: action.state, connectionDetail: action.detail ?? null };
    case 'event':
      return applyEvents(state, [action]);
    case 'events':
      return action.items.length ? applyEvents(state, action.items) : state;
  }
}

const faultKey = (code: string, node: string) => `${code}@${node}`;

/** A new monitor boot invalidates everything it reported before. */
function onMonitorBoot(s: DashboardState, bootId: string, atMs: number): DashboardState {
  if (s.monitorBootId === bootId) return s;
  const history: FaultHistoryEntry[] =
    s.monitorBootId === null
      ? s.faultHistory
      : [
          {
            key: `boot:${bootId}`,
            code: 'MONITOR_RESTARTED',
            node: 'monitor',
            severity: 'info',
            state: 'cleared',
            detail: `monitor boot ${s.monitorBootId} -> ${bootId}; earlier faults no longer tracked`,
            atMs,
          },
          ...s.faultHistory,
        ];
  return { ...s, monitorBootId: bootId, lastFaultEventId: 0, activeFaults: [], faultHistory: history.slice(0, MAX_FAULT_HISTORY) };
}

function applyFault(s: DashboardState, e: FaultEvent, atMs: number): DashboardState {
  s = onMonitorBoot(s, e.bootId, atMs);
  if (e.eventId <= s.lastFaultEventId) return s;  // already applied (or older than a snapshot)
  const key = faultKey(e.code, e.node);
  const others = s.activeFaults.filter((f) => faultKey(f.code, f.node) !== key);
  const activeFaults =
    e.state === 'active'
      ? [...others, { code: e.code, node: e.node, severity: e.severity, detail: e.detail, sinceMs: atMs }]
      : others;
  const entry: FaultHistoryEntry = {
    key: `${e.bootId}:${e.eventId}`,
    code: e.code,
    node: e.node,
    severity: e.severity,
    state: e.state,
    detail: e.detail,
    atMs,
    deviceTimeUs: e.deviceTimeUs,
  };
  return {
    ...s,
    activeFaults,
    lastFaultEventId: e.eventId,
    faultHistory: [entry, ...s.faultHistory].slice(0, MAX_FAULT_HISTORY),
  };
}

function applySnapshot(s: DashboardState, active: ActiveFault[], bootId: string, lastEventId: number, truncated: boolean, atMs: number): DashboardState {
  s = onMonitorBoot(s, bootId, atMs);
  // A snapshot older than an event we already applied must not undo it.
  if (lastEventId < s.lastFaultEventId) return s;
  const prev = new Map(s.activeFaults.map((f) => [faultKey(f.code, f.node), f]));
  const activeFaults = active.map((a) => ({
    code: a.code,
    node: a.node,
    severity: a.severity,
    detail: a.detail,
    sinceMs: prev.get(faultKey(a.code, a.node))?.sinceMs ?? atMs - a.ageMs,
  }));
  return { ...s, activeFaults, lastFaultEventId: lastEventId, lastSnapshotMs: atMs, snapshotTruncated: truncated };
}

function applyEvents(state: DashboardState, items: { event: CanScopeEvent; receivedAtMs: number }[]): DashboardState {
  let s: DashboardState = { ...state };
  let frames: StoredFrame[] | null = null;
  for (const { event, receivedAtMs } of items) {
    const prev = s.nodes[event.sourceNode];
    s.nodes = {
      ...s.nodes,
      [event.sourceNode]: {
        node: event.sourceNode,
        lastSeenMs: receivedAtMs,
        framesReported: (prev?.framesReported ?? 0) + (event.type === 'frame' ? 1 : 0),
        status: event.type === 'status' ? event : (prev?.status ?? null),
      },
    };
    s.lastEventMs = receivedAtMs;
    switch (event.type) {
      case 'frame': {
        frames ??= [...s.frames];
        frames.push({ ...event, seq: s.nextSeq, receivedAtMs });
        s.nextSeq += 1;
        break;
      }
      case 'telemetry':
        s.telemetry = { ...s.telemetry, [event.node]: { event, receivedAtMs } };
        break;
      case 'node_health':
        s.health = { ...s.health, [event.node]: { event, receivedAtMs } };
        break;
      case 'fault':
        s = applyFault(s, event, receivedAtMs);
        break;
      case 'faults':
        s = applySnapshot(s, event.active, event.bootId, event.lastEventId, event.truncated, receivedAtMs);
        break;
      case 'ecu_state':
        if (event.sourceNode === 'node1' || event.sourceNode === 'node2') {
          s.ecuStates = { ...s.ecuStates, [event.sourceNode]: { event, receivedAtMs } };
        }
        break;
      case 'hello':
        s.hellos = { ...s.hellos, [event.sourceNode as DeviceNode]: { event, receivedAtMs } };
        if (event.sourceNode === 'monitor') s = onMonitorBoot(s, event.bootId, receivedAtMs);
        break;
      case 'selftest':
        s.selftest = event;
        break;
      case 'status':
      case 'ack':
        break;
    }
  }
  if (frames) {
    if (frames.length > MAX_FRAMES) {
      s.droppedFromView += frames.length - MAX_FRAMES;
      frames = frames.slice(frames.length - MAX_FRAMES);
    }
    s.frames = frames;
  }
  return s;
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

/** Observed telemetry: unavailable, stale, or current. */
export type TelemetryView =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'stale' | 'current'; event: TelemetryEvent; ageMs: number; reason: string | null };

export function telemetryView(state: DashboardState, node: EcuNode, nowMs: number): TelemetryView {
  const monitor = state.nodes.monitor;
  if (!monitor) return { kind: 'unavailable', reason: 'Node 3 (monitor) is not connected: nothing has been observed on CAN.' };
  const t = state.telemetry[node];
  if (!t) return { kind: 'unavailable', reason: 'Node 3 has not reported telemetry for this ECU yet.' };
  if (!t.event.valid) return { kind: 'unavailable', reason: 'Node 3 has not received a valid telemetry frame from this ECU.' };
  const sinceReport = nowMs - t.receivedAtMs;
  const ageMs = (t.event.ageMs ?? 0) + sinceReport;
  if (sinceReport > TELEMETRY_STALE_MS) {
    return { kind: 'stale', event: t.event, ageMs, reason: 'no update from Node 3 (USB link quiet)' };
  }
  if (t.event.state !== 'ok') {
    return { kind: 'stale', event: t.event, ageMs, reason: `Node 3 reports telemetry ${t.event.state}` };
  }
  return { kind: 'current', event: t.event, ageMs, reason: null };
}

const SEVERITY_ORDER: Record<FaultSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function sortedActiveFaults(faults: readonly ActiveFaultEntry[]): ActiveFaultEntry[] {
  return [...faults].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.sinceMs - b.sinceMs || a.code.localeCompare(b.code),
  );
}
