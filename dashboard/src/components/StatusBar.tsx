import type { ConnectionState } from '../lib/data-source';
import type { DataOrigin } from '../types/events';
import { StatusLabel, type StatusTone } from './StatusIcon';

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
};

const CONNECTION_TONE: Record<ConnectionState, StatusTone> = {
  idle: 'muted',
  connecting: 'warn',
  connected: 'ok',
  disconnected: 'bad',
  error: 'bad',
};

interface Props {
  origin: DataOrigin;
  sourceLabel: string;
  connection: ConnectionState;
  /** Physical mode: "2 of 3 boards" instead of a bare "Connected". */
  boardsConnected?: number;
  children?: React.ReactNode;
}

export function StatusBar({ origin, sourceLabel, connection, boardsConnected, children }: Props) {
  const connectionText =
    connection === 'connected' && boardsConnected !== undefined
      ? `USB: ${boardsConnected} of 3 boards`
      : CONNECTION_LABEL[connection];
  return (
    <header className="status-bar">
      <div className="brand">
        <h1>CANScope</h1>
        <span className="brand-sub">CAN bus monitor · three-node ESP32 bench</span>
      </div>
      <div className="status-items">
        <span
          className={`badge ${origin === 'mock' ? 'badge-mock' : 'badge-source'}`}
          data-testid="data-origin"
          title={sourceLabel}
        >
          {origin === 'mock' ? 'MOCK DATA' : 'PHYSICAL'}
        </span>
        <span data-testid="connection-status" role="status">
          <StatusLabel tone={CONNECTION_TONE[connection]}>{connectionText}</StatusLabel>
        </span>
        {children}
      </div>
    </header>
  );
}
