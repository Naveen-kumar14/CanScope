// Transport-neutral data boundary between the UI and whatever delivers CANScope
// events: the physical USB-serial source (serial/physical-source.ts) or the
// mock preview (mock-data/mock-source.ts).
//
// CanDataSource is receive-only. Commands to physical nodes go through the
// separate CommandChannel below, which only the physical source implements:
// it sends allow-listed text commands to an ECU or the monitor over USB and
// tracks each one until the device acknowledges it. There is no way to put an
// arbitrary frame on the CAN bus from the dashboard.

import type { DeviceNode, CanScopeEvent, DataOrigin } from '../types/events';
import type { CommandRecord } from './serial/command-tracker';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface DataSourceHandlers {
  onEvent(event: CanScopeEvent): void;
  onConnectionChange(state: ConnectionState, detail?: string): void;
}

export interface CanDataSource {
  readonly kind: DataOrigin;
  readonly label: string;
  connect(handlers: DataSourceHandlers): void;
  disconnect(): void;
}

export interface CommandChannel {
  sendCommand(node: DeviceNode, text: string): Promise<CommandRecord>;
}
