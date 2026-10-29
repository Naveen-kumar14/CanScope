import { isNodeStale, type NodeHealth } from '../lib/dashboard-state';
import { BUS_STATE_LABEL, BUS_STATE_TONE, formatAge } from '../lib/format';
import { nodeLabel } from '../lib/protocol';
import type { BusState, DeviceNode } from '../types/events';
import { StatusLabel } from './StatusIcon';

interface Props {
  nodes: Record<string, NodeHealth>;
  nowMs: number;
}

const KNOWN: readonly string[] = ['node1', 'node2', 'monitor'];
const label = (n: string) => (KNOWN.includes(n) ? nodeLabel(n as DeviceNode) : n);
// Shorter wording for this table only; the reported state itself is unchanged.
const stateLabel = (s: BusState) => (s === 'error_active' ? 'Active (normal)' : BUS_STATE_LABEL[s]);

/** CAN controller state as each board reports it on its own USB port. */
export function NodeHealthCards({ nodes, nowMs }: Props) {
  const list = Object.values(nodes).sort((a, b) => a.node.localeCompare(b.node));
  return (
    <section className="card" aria-labelledby="controllers-title">
      <h2 id="controllers-title">CAN controllers</h2>
      <p className="card-intro">
        Reported by each board about its own TWAI controller, once per second. TX failed rising with no RX means frames are
        not acknowledged: check the CAN wiring, not USB.
      </p>
      {list.length === 0 ? (
        <p className="muted" data-testid="nodes-empty">
          No board has reported yet.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table controllers">
            <thead>
              <tr>
                <th scope="col">Board</th>
                <th scope="col">Last report</th>
                <th scope="col">Controller</th>
                <th scope="col">Mode</th>
                <th scope="col" className="num">TEC / REC</th>
                <th scope="col" className="num">RX frames</th>
                <th scope="col" className="num">TX frames</th>
                <th scope="col" className="num">TX failed</th>
                <th scope="col" className="num">Bus errors</th>
                <th scope="col" className="num">RX missed</th>
              </tr>
            </thead>
            <tbody>
              {list.map((n) => {
                const s = n.status;
                const stale = isNodeStale(n, nowMs);
                return (
                  <tr key={n.node} className={stale ? 'dimmed' : ''} data-testid={`node-${n.node}`}>
                    <th scope="row">{label(n.node)}</th>
                    <td className={stale ? 'tone-warn' : ''}>
                      {formatAge(nowMs - n.lastSeenMs)}
                      {stale && ' (stale)'}
                    </td>
                    <td>
                      {!s ? (
                        <span className="muted">no status yet</span>
                      ) : !s.driverRunning && s.busState !== 'bus_off' ? (
                        <StatusLabel tone="bad">not running</StatusLabel>
                      ) : (
                        <StatusLabel tone={BUS_STATE_TONE[s.busState]}>{stateLabel(s.busState)}</StatusLabel>
                      )}
                    </td>
                    <td>{s ? `${s.mode}${s.txEnabled ? '' : ', TX off'}` : '—'}</td>
                    <td className="num mono">{s ? `${s.txErrorCount} / ${s.rxErrorCount}` : '—'}</td>
                    <td className="num mono">{s ? s.rxFrames : '—'}</td>
                    <td className="num mono">{s ? s.txFrames : '—'}</td>
                    <td className={`num mono ${s && s.txFailed > 0 ? 'tone-warn' : ''}`}>{s ? s.txFailed : '—'}</td>
                    <td className={`num mono ${s && s.busErrors > 0 ? 'tone-warn' : ''}`}>{s ? s.busErrors : '—'}</td>
                    <td className={`num mono ${s && s.rxMissed > 0 ? 'tone-warn' : ''}`}>{s ? s.rxMissed : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
