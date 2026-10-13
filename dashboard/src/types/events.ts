// CANScope dashboard event model (transport-neutral).
//
// These shapes are the contract between any data source (mock, serial bridge,
// WebSocket, HTTP...) and the UI. They mirror the firmware serial JSON lines
// (firmware/common/frame_capture/raw_frame.cpp, can_transport.cpp) plus fields
// the host adds (ISO timestamp, origin, verified). See docs/architecture.md.

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

export interface CanFrameEvent {
  type: 'frame';
  /** Host receive time, ISO-8601. The ESP32 has no wall clock. */
  timestamp: string;
  /** Device monotonic time in microseconds, if reported. */
  deviceTimeUs?: number;
  /** Node that captured and reported the frame (not necessarily the sender). */
  sourceNode: string;
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
  origin: DataOrigin;
}

export interface NodeStatusEvent {
  type: 'status';
  timestamp: string;
  deviceTimeUs?: number;
  sourceNode: string;
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
  origin: DataOrigin;
}

export type CanScopeEvent = CanFrameEvent | NodeStatusEvent;

/** Frame as stored by the dashboard: a sequence number and receive time added. */
export interface StoredFrame extends CanFrameEvent {
  seq: number;
  receivedAtMs: number;
}
