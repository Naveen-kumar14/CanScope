import { useState } from 'react';

import { formatAge } from '../lib/format';
import { nodeLabel } from '../lib/protocol';
import type { ForgetResult, LinkInfo, PhysicalSnapshot } from '../lib/serial/physical-source';
import type { PortState } from '../lib/serial/serial-link';
import { StatusIcon, StatusLabel, type StatusTone } from './StatusIcon';

interface Props {
  snapshot: PhysicalSnapshot;
  nowMs: number;
  onAddPort: () => Promise<string | null>;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onForget: (id: string) => Promise<ForgetResult>;
  onOpenAll: () => void;
}

const STATE_TONE: Record<PortState, StatusTone> = {
  closed: 'muted',
  opening: 'warn',
  open: 'ok',
  closing: 'warn',
  error: 'bad',
  lost: 'bad',
};

function stateText(link: LinkInfo): string {
  switch (link.state) {
    case 'open': return 'Connected';
    case 'opening': return 'Connecting…';
    case 'closing': return 'Disconnecting…';
    case 'closed': return 'Not connected';
    case 'error': return 'Could not open';
    case 'lost': return link.wantOpen ? 'Lost — reconnects when plugged in' : 'Lost';
  }
}

const EXPECTED = ['node1', 'node2', 'monitor'] as const;
/** Device lines arrive at least once per second; quieter than this is suspicious. */
const LINK_QUIET_MS = 3000;

export function ConnectionPanel({ snapshot, nowMs, onAddPort, onOpen, onClose, onForget, onOpenAll }: Props) {
  const [pickError, setPickError] = useState<string | null>(null);
  const [forgetNotice, setForgetNotice] = useState<ForgetResult | null>(null);
  const forget = async (id: string) => setForgetNotice(await onForget(id));

  if (!snapshot.supported) {
    return (
      <section className="card connection" aria-label="Serial connection" data-testid="connection-panel">
        <h2>USB serial connections</h2>
        <p data-testid="serial-unsupported">
          <StatusLabel tone="bad">{snapshot.unsupportedReason} No data is shown and nothing is simulated.</StatusLabel>
        </p>
      </section>
    );
  }

  const openLinks = snapshot.links.filter((l) => l.state === 'open');
  const closedKnown = snapshot.links.filter((l) => l.state !== 'open' && l.state !== 'opening');

  return (
    <section className="card connection" aria-label="Serial connection" data-testid="connection-panel">
      <div className="card-head">
        <h2>USB serial connections</h2>
        <div className="row">
          <button
            type="button"
            className="btn-primary"
            onClick={async () => setPickError(await onAddPort())}
            data-testid="add-port"
            title="Choose an ESP32 USB serial port (one per node)"
          >
            Add serial port…
          </button>
          {closedKnown.length > 0 && (
            <button type="button" onClick={onOpenAll} data-testid="open-all">
              Reconnect closed ports ({closedKnown.length})
            </button>
          )}
        </div>
      </div>
      <p className="card-intro">
        The browser talks to each ESP32 directly (Web Serial, 460800 baud). A connected port proves only the USB link;
        whether CAN works is shown on the Overview.
      </p>
      {pickError && (
        <p className="small" role="alert">
          <StatusLabel tone="warn">Port not opened: {pickError}</StatusLabel>
        </p>
      )}
      {forgetNotice && (
        <p className="small" role="status" data-testid="forget-notice">
          <StatusLabel tone={forgetNotice.permission === 'revoked' ? 'ok' : forgetNotice.removed ? 'warn' : 'bad'}>
            {forgetNotice.detail}
          </StatusLabel>
        </p>
      )}

      <ul className="expected-nodes" aria-label="Expected boards">
        {EXPECTED.map((n) => {
          const link = openLinks.find((l) => l.node === n);
          const ok = !!link && !link.conflict;
          return (
            <li key={n} data-testid={`expected-${n}`}>
              <StatusIcon tone={ok ? 'ok' : 'muted'} /> <strong>{nodeLabel(n)}</strong>{' '}
              <span className="muted">{ok ? `on ${link.label}` : '— not connected'}</span>
            </li>
          );
        })}
      </ul>

      {snapshot.links.length === 0 ? (
        <p className="muted" data-testid="no-ports">
          No serial port connected in this session. Plug in a CANScope node, press <strong>Add serial port…</strong> and
          pick its port (CP210x / CH340). Repeat for each node; ports are identified by what the board reports, not by
          order. Ports used before stay allowed in the browser, but every start begins fresh.
        </p>
      ) : (
        <div className="link-grid">
          {snapshot.links.map((l) => (
            <LinkCard key={l.id} link={l} nowMs={nowMs} onOpen={onOpen} onClose={onClose} onForget={(id) => void forget(id)} />
          ))}
        </div>
      )}
    </section>
  );
}

interface LinkCardProps {
  link: LinkInfo;
  nowMs: number;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onForget: (id: string) => void;
}

function LinkCard({ link, nowMs, onOpen, onClose, onForget }: LinkCardProps) {
  const quiet = link.state === 'open' && (link.lastLineAtMs === null || nowMs - link.lastLineAtMs > LINK_QUIET_MS);
  return (
    <article className="link-card" data-testid={`link-${link.id}`}>
      <header className="row-between">
        <h3>{link.node ? nodeLabel(link.node) : 'Unidentified port'}</h3>
        <StatusLabel tone={STATE_TONE[link.state]} testId={`link-state-${link.id}`}>
          {stateText(link)}
        </StatusLabel>
      </header>
      <dl className="small">
        <dt>Port</dt>
        <dd>{link.label}</dd>
        <dt>Device</dt>
        <dd>
          {link.role ? `${link.role} · fw ${link.firmware ?? '?'} · protocol v${link.protocolVersion ?? '?'}` : link.node ? 'identified by status line (waiting for hello)' : 'not identified yet'}
          {link.bootId && <span className="muted"> · boot {link.bootId}</span>}
        </dd>
        <dt>Last line</dt>
        <dd className={quiet ? 'tone-warn' : ''}>
          {link.lastLineAtMs === null ? 'none' : formatAge(nowMs - link.lastLineAtMs)}
          {quiet && ' — no data (wrong port, wrong baud rate, or board not running CANScope firmware?)'}
        </dd>
        <dt>Lines</dt>
        <dd>
          {link.lines} received · <span className={link.invalidLines ? 'tone-warn' : ''}>{link.invalidLines} invalid</span> ·{' '}
          <span className={link.overflows ? 'tone-warn' : ''}>{link.overflows} oversized</span>
          {link.restarts > 0 && <span className="tone-warn"> · {link.restarts} device restart(s)</span>}
        </dd>
        {link.lastInvalid && (
          <>
            <dt>Last invalid</dt>
            <dd className="mono small muted">{link.lastInvalid}</dd>
          </>
        )}
      </dl>
      {link.conflict && (
        <p className="small">
          <StatusLabel tone="bad">Conflict: {link.conflict}. Commands to this node are blocked.</StatusLabel>
        </p>
      )}
      {link.detail && link.state !== 'open' && <p className={`small tone-${STATE_TONE[link.state]}`}>{link.detail}</p>}
      <div className="row">
        {link.state === 'open' || link.state === 'opening' ? (
          <button type="button" onClick={() => onClose(link.id)} data-testid={`close-${link.id}`}>
            Disconnect
          </button>
        ) : (
          <button type="button" onClick={() => onOpen(link.id)} data-testid={`open-${link.id}`}>
            {link.state === 'lost' || link.state === 'error' ? 'Reconnect' : 'Connect'}
          </button>
        )}
        {link.node === null && (
          <button
            type="button"
            onClick={() => onForget(link.id)}
            data-testid={`forget-${link.id}`}
            title="Close this port and remove it from the dashboard; add it again with Add serial port…"
            aria-label={`Forget ${link.label}`}
          >
            Forget port
          </button>
        )}
      </div>
      {link.diagnostics.length > 0 && (
        <details>
          <summary className="small muted">Device diagnostics ({link.diagnostics.length})</summary>
          <pre className="diag">{link.diagnostics.join('\n')}</pre>
        </details>
      )}
    </article>
  );
}
