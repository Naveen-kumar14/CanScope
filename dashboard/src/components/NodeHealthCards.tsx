import { isNodeStale, type NodeHealth } from '../lib/dashboard-state';
import { BUS_STATE_LABEL, BUS_STATE_TONE, formatAge } from '../lib/format';

interface Props {
  nodes: Record<string, NodeHealth>;
  nowMs: number;
}

export function NodeHealthCards({ nodes, nowMs }: Props) {
  const list = Object.values(nodes).sort((a, b) => a.node.localeCompare(b.node));
  return (
    <section aria-label="Node health">
      <h2>Node health</h2>
      {list.length === 0 ? (
        <p className="muted" data-testid="nodes-empty">No node has reported yet.</p>
      ) : (
        <div className="node-grid">
          {list.map((n) => {
            const s = n.status;
            const stale = isNodeStale(n, nowMs);
            return (
              <article key={n.node} className={`card node-card ${stale ? 'dimmed' : ''}`} data-testid={`node-${n.node}`}>
                <header>
                  <h3>{n.node}</h3>
                  {stale && <span className="badge badge-warn">stale</span>}
                </header>
                <dl>
                  <dt>Last seen</dt>
                  <dd>{formatAge(nowMs - n.lastSeenMs)}</dd>
                  <dt>Bus state</dt>
                  <dd className={s ? `tone-${BUS_STATE_TONE[s.busState]}` : 'muted'}>
                    {s ? BUS_STATE_LABEL[s.busState] : 'no status yet'}
                  </dd>
                  <dt>CAN driver</dt>
                  <dd className={s && !s.driverRunning ? 'tone-warn' : ''}>
                    {s ? (s.driverRunning ? 'running' : 'not running') : '—'}
                  </dd>
                  <dt>Mode / TX</dt>
                  <dd>{s ? `${s.mode} / ${s.txEnabled ? 'TX enabled' : 'TX disabled'}` : '—'}</dd>
                  <dt>Config</dt>
                  <dd className={s && s.configStatus !== 'VERIFIED' ? 'tone-warn' : ''}>
                    {s ? s.configStatus : '—'}
                  </dd>
                  <dt>TEC / REC</dt>
                  <dd>{s ? `${s.txErrorCount} / ${s.rxErrorCount}` : '—'}</dd>
                  <dt>Frames reported</dt>
                  <dd>{n.framesReported}</dd>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
