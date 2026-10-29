// CANScope dashboard event model (transport-neutral).
//
// These shapes are the contract between any data source (USB serial via Web
// Serial, or the mock preview) and the UI. They mirror the firmware serial
// JSON lines (firmware/common/frame_capture, can_transport, serial_link,
// ecu_core, monitor_core) plus fields the host adds: ISO timestamp, origin,
// verified and the serial link the line arrived on. See
// docs/protocol/canscope-protocol-v1.md.

export type IdentifierFormat = 'standard' | 'extended';

export type BusState =
  | 'unknown'
  | 'stopped'
  | 'error_active'
  | 'error_warning'
  | 'error_passive'
  | 'bus_off'
  | 'recovering';

/** Where the event came from. 'mock' must always be visible in the UI. */
export type DataOrigin = 'mock' | 'live';

export type ValueStatus = 'UNVERIFIED' | 'WORKING_ASSUMPTION' | 'VERIFIED';

/** Physical CANScope nodes as they name themselves on USB serial. */
export type DeviceNode = 'node1' | 'node2' | 'monitor';
export type EcuNode = 'node1' | 'node2';
export type LinkState = 'unknown' | 'waiting' | 'ok' | 'lost';
export type FaultSeverity = 'info' | 'warning' | 'critical';

interface Base {
  /** Host receive time, ISO-8601. The ESP32 has no wall clock. */
  timestamp: string;
  /** Device monotonic time in microseconds, if reported. */
  deviceTimeUs?: number;
  /** Node that produced the line. */
  sourceNode: string;
  origin: DataOrigin;
  /** Host-side id of the serial link the line arrived on (live data only). */
  link?: string;
}

export interface CanFrameEvent extends Base {
  type: 'frame';
  /** "0x" + 3 hex digits (standard) or 8 hex digits (extended), upper case. */
  canId: string;
  identifierFormat: IdentifierFormat;
  remote: boolean;
  dlc: number;
  data: number[];
  busState: BusState;
  txErrorCount?: number;
  rxErrorCount?: number;
  /** True only when decoded against a VERIFIED registry entry. */
  verified: boolean;
  /** Node 3 verdict on the frame (protocol v1 monitor firmware only). */
  kind?: string;
  check?: string;
  accepted?: boolean;
}

/** Start-up transceiver echo check (firmware can_transport/transceiver_check.h). */
export type TransceiverCheck = 'not_run' | 'ok' | 'rx_not_driven' | 'rx_stuck_dominant' | 'no_echo' | 'inconsistent';

export interface NodeStatusEvent extends Base {
  type: 'status';
  busState: BusState;
  driverRunning: boolean;
  mode: 'listen_only' | 'normal' | 'no_ack' | string;
  txEnabled: boolean;
  bitrate: number;
  configStatus: ValueStatus;
  txErrorCount: number;
  rxErrorCount: number;
  rxFrames: number;
  txFrames: number;
  txFailed: number;
  rxMissed: number;
  busErrors: number;
  arbitrationLost: number;
  busOffEvents: number;
  /** null: the firmware does not report the check (older build). */
  transceiverCheck: TransceiverCheck | null;
}

export interface HelloEvent extends Base {
  type: 'hello';
  nodeId: number;
  role: string;
  firmware: string;
  bootId: string;
  protocolVersion: number;
  serialProtocolVersion: number;
  commands: string[];
}

export type AckStatus = 'ok' | 'rejected' | 'unsupported';

export interface AckEvent extends Base {
  type: 'ack';
  bootId: string;
  id: string;
  command: string;
  status: AckStatus;
  detail: string;
}

/** Values Node 3 decoded from CAN frames it actually received. */
export interface TelemetryEvent extends Base {
  type: 'telemetry';
  node: EcuNode;
  valid: boolean;
  ageMs: number | null;
  counter: number;
  state: LinkState;
  values: Record<string, number>;
}

export interface NodeHealthEvent extends Base {
  type: 'node_health';
  node: EcuNode;
  heartbeat: LinkState;
  telemetry: LinkState;
  heartbeatAgeMs: number | null;
  telemetryAgeMs: number | null;
  protocolVersion: number | null;
  versionOk: boolean;
  firmware: string | null;
  ecuCanState: string | null;
  stats: Record<string, number>;
}

/** One fault raised or cleared by Node 3's own detection. */
export interface FaultEvent extends Base {
  type: 'fault';
  bootId: string;
  eventId: number;
  code: string;
  node: DeviceNode;
  severity: FaultSeverity;
  state: 'active' | 'cleared';
  detail: string;
}

export interface ActiveFault {
  code: string;
  node: DeviceNode;
  severity: FaultSeverity;
  ageMs: number;
  detail: string;
}

/** Periodic authoritative list of Node 3's active faults. */
export interface FaultSnapshotEvent extends Base {
  type: 'faults';
  bootId: string;
  lastEventId: number;
  count: number;
  active: ActiveFault[];
  truncated: boolean;
}

/** What an ECU reports about itself over its own USB port (commanded state). */
export interface EcuStateEvent extends Base {
  type: 'ecu_state';
  bootId: string;
  role: string;
  canRunning: boolean;
  busState: string;
  profile: string;
  demoFault: string;
  setpoint: Record<string, number>;
  sent: Record<string, number>;
  telemetryFrames: number;
  heartbeatFrames: number;
  txOk: number;
  txFailed: number;
  rxIgnored: number;
}

export interface SelftestEvent extends Base {
  type: 'selftest';
  bootId: string;
  can: string;
  oled: string;
  leds: string;
}

export type CanScopeEvent =
  | CanFrameEvent
  | NodeStatusEvent
  | HelloEvent
  | AckEvent
  | TelemetryEvent
  | NodeHealthEvent
  | FaultEvent
  | FaultSnapshotEvent
  | EcuStateEvent
  | SelftestEvent;

/** Frame as stored by the dashboard: a sequence number and receive time added. */
export interface StoredFrame extends CanFrameEvent {
  seq: number;
  receivedAtMs: number;
}
