import { useState } from 'react';

import { formatAge } from '../lib/format';
import { nodeLabel } from '../lib/protocol';
import type { LinkInfo, PhysicalSnapshot } from '../lib/serial/physical-source';
import type { PortState } from '../lib/serial/serial-link';

interface Props {
  snapshot: PhysicalSnapshot;
  nowMs: number;
  onAddPort: () => Promise<string | null>;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onOpenAll: () => void;
}

const STATE_TONE: Record<PortState, string> = {
  closed: 'muted',
  opening: 'warn',
  open: 'ok',
  closing: 'warn',
  error: 'bad',
  lost: 'bad',
};

const EXPECTED = ['node1', 'node2', 'monitor'] as const;
/** Device lines arrive at least once per second; quieter than this is suspicious. */
const LINK_QUIET_MS = 3000;

export function ConnectionPanel({ snapshot, nowMs, onAddPort, onOpen, onClose, onOpenAll }: Props) {
  const [pickError, setPickError] = useState<string | null>(null);

  if (!snapshot.supported) {
    return (
      <section className="card connection" aria-label="Serial connection" data-testid="connection-panel">
        <h2>Physical connection</h2>
        <p className="tone-bad" data-testid="serial-unsupported">
          {snapshot.unsupportedReason} No data is shown and nothing is simulated.
        </p>
      </section>
    );
  }

  const openLinks = snapshot.links.filter((l) => l.state === 'open');
  const closedKnown = snapshot.links.filter((l) => l.state !== 'open' && l.state !== 'opening');

  return (
    <section className="card connection" aria-label="Serial connection" data-testid="connection-panel">
      <div className="row-between">
        <h2>Physical connection · USB serial</h2>
        <div className="row">
          <button
            type="button"
            onClick={async () => setPickError(await onAddPort())}
            data-testid="add-port"
            title="Choose an ESP32 USB serial port (one per node)"
          >
            Add serial port…
          </button>
          {closedKnown.length > 0 && (
            <button type="button" onClick={onOpenAll} data-testid="open-all">
              Connect known ports ({closedKnown.length})
            </button>
          )}
        </div>
      </div>
      {pickError && <p className="tone-warn small">Port not opened: {pickError}</p>}

      <ul className="expected-nodes" aria-label="Expected nodes">
        {EXPECTED.map((n) => {
          const link = openLinks.find((l) => l.node === n);
          const ok = !!link && !link.conflict;
          return (
            <li key={n} className={ok ? 'tone-ok' : 'tone-muted'} data-testid={`expected-${n}`}>
              {ok ? '●' : '○'} {nodeLabel(n)} {ok ? `on ${link.label}` : '— not connected'}
            </li>
          );
        })}
      </ul>

      {snapshot.links.length === 0 ? (
        <p className="muted" data-testid="no-ports">
          No serial port granted yet. Plug in a CANScope node, press <strong>Add serial port…</strong> and pick its
          port (CP210x / CH340). Repeat for each node; ports are identified by what the board reports, not by order.
        </p>
      ) : (
        <div className="link-grid">
          {snapshot.links.map((l) => (
            <LinkCard key={l.id} link={l} nowMs={nowMs} onOpen={onOpen} onClose={onClose} />
          ))}
        </div>
      )}
    </section>
  );
}

function LinkCard({ link, nowMs, onOpen, onClose }: { link: LinkInfo; nowMs: number; onOpen: (id: string) => void; onClose: (id: string) => void }) {
  const quiet = link.state === 'open' && (link.lastLineAtMs === null || nowMs - link.lastLineAtMs > LINK_QUIET_MS);
  return (
    <article className="link-card" data-testid={`link-${link.id}`}>
      <header className="row-between">
        <strong>{link.node ? nodeLabel(link.node) : 'Unidentified port'}</strong>
        <span className={`pill tone-${STATE_TONE[link.state]}`}>
          <span className="dot" aria-hidden="true" />
          {link.state}
        </span>
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
      {link.conflict && <p className="tone-bad small">Conflict: {link.conflict}. Commands to this node are blocked.</p>}
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
