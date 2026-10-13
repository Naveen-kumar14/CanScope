import type { ConnectionState } from '../lib/data-source';
import type { DataOrigin } from '../types/events';

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
};

const CONNECTION_TONE: Record<ConnectionState, string> = {
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
  children?: React.ReactNode;
}

export function StatusBar({ origin, sourceLabel, connection, children }: Props) {
  return (
    <header className="status-bar">
      <div className="brand">
        <h1>CANScope</h1>
        <span className="badge badge-readonly" title="This dashboard cannot transmit CAN frames or control anything">
          Read-only monitor · no CAN transmission
        </span>
      </div>
      <div className="status-items">
        <span
          className={`badge ${origin === 'mock' ? 'badge-mock' : 'badge-live'}`}
          data-testid="data-origin"
        >
          {origin === 'mock' ? 'MOCK DATA' : 'LIVE DATA'}
        </span>
        <span className={`pill tone-${CONNECTION_TONE[connection]}`} data-testid="connection-status">
          <span className="dot" aria-hidden="true" />
          {CONNECTION_LABEL[connection]}
        </span>
        <span className="source-label">{sourceLabel}</span>
        {children}
      </div>
    </header>
  );
}
