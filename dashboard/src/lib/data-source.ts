// Transport-neutral data boundary between the UI and whatever delivers CAN
// events (mock generator today; serial bridge / WebSocket / HTTP later).
//
// READ-ONLY BY DESIGN: this interface has no send/transmit/command method.
//
// Future extension point (NOT implemented, needs a separate approved spec):
// a command channel would be a *separate* interface (e.g. `CanCommandChannel`)
// with its own authorization, allow-listed IDs and audit log. It must not be
// added to CanDataSource. See docs/architecture.md "Out of scope".

import type { CanScopeEvent, DataOrigin } from '../types/events';

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
