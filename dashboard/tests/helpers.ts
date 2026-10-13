import type { CanDataSource, ConnectionState, DataSourceHandlers } from '../src/lib/data-source';
import type { CanFrameEvent, NodeStatusEvent } from '../src/types/events';

/** Test double: the test drives connection changes and events by hand. */
export class FakeSource implements CanDataSource {
  readonly kind: 'mock' | 'live';
  readonly label: string;
  handlers: DataSourceHandlers | null = null;
  disconnected = false;

  constructor(kind: 'mock' | 'live' = 'mock', label = 'Fake source') {
    this.kind = kind;
    this.label = label;
  }
  connect(handlers: DataSourceHandlers) {
    this.handlers = handlers;
  }
  disconnect() {
    this.disconnected = true;
  }
  setConnection(state: ConnectionState, detail?: string) {
    this.handlers!.onConnectionChange(state, detail);
  }
  emit(event: CanFrameEvent | NodeStatusEvent) {
    this.handlers!.onEvent(event);
  }
}

// EXAMPLE values only; not project CAN definitions.
export function frame(overrides: Partial<CanFrameEvent> = {}): CanFrameEvent {
  return {
    type: 'frame',
    timestamp: new Date().toISOString(),
    sourceNode: 'monitor',
    canId: '0x7A0',
    identifierFormat: 'standard',
    remote: false,
    dlc: 2,
    data: [0x12, 0x34],
    busState: 'error_active',
    verified: false,
    origin: 'mock',
    ...overrides,
  };
}

export function status(overrides: Partial<NodeStatusEvent> = {}): NodeStatusEvent {
  return {
    type: 'status',
    timestamp: new Date().toISOString(),
    sourceNode: 'monitor',
    busState: 'error_active',
    driverRunning: true,
    mode: 'listen_only',
    txEnabled: false,
    bitrate: 500000,
    configStatus: 'WORKING_ASSUMPTION',
    txErrorCount: 0,
    rxErrorCount: 0,
    rxFrames: 10,
    txFrames: 0,
    txFailed: 0,
    rxMissed: 0,
    busErrors: 0,
    arbitrationLost: 0,
    busOffEvents: 0,
    origin: 'mock',
    ...overrides,
  };
}
