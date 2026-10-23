import { TRANSCEIVER_CHECK_TEXT } from '../lib/bus-diagnosis';
import { isNodeStale, type NodeHealth } from '../lib/dashboard-state';
import { BUS_STATE_LABEL, BUS_STATE_TONE, formatAge } from '../lib/format';
import { nodeLabel } from '../lib/protocol';
import type { DeviceNode } from '../types/events';
import { StatusLabel } from './StatusIcon';

interface Props {
  nodes: Record<string, NodeHealth>;
  nowMs: number;
}

const KNOWN: readonly string[] = ['node1', 'node2', 'monitor'];
const label = (n: string) => (KNOWN.includes(n) ? nodeLabel(n as DeviceNode) : n);

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
                <th scope="col">Transceiver echo</th>
                <th scope="col">Pin config</th>
              </tr>
            </thead>
            <tbody>
              {list.map((n) => {
                const s = n.status;
                const stale = isNodeStale(n, nowMs);
                const echo = s?.transceiverCheck ?? null;
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
                        <StatusLabel tone={BUS_STATE_TONE[s.busState]}>{BUS_STATE_LABEL[s.busState]}</StatusLabel>
                      )}
                    </td>
                    <td>{s ? `${s.mode}${s.txEnabled ? '' : ', TX off'}` : '—'}</td>
                    <td className="num mono">{s ? `${s.txErrorCount} / ${s.rxErrorCount}` : '—'}</td>
                    <td className="num mono">{s ? s.rxFrames : '—'}</td>
                    <td className="num mono">{s ? s.txFrames : '—'}</td>
                    <td className={`num mono ${s && s.txFailed > 0 ? 'tone-warn' : ''}`}>{s ? s.txFailed : '—'}</td>
                    <td className={`num mono ${s && s.busErrors > 0 ? 'tone-warn' : ''}`}>{s ? s.busErrors : '—'}</td>
                    <td className={`num mono ${s && s.rxMissed > 0 ? 'tone-warn' : ''}`}>{s ? s.rxMissed : '—'}</td>
                    <td title={echo ? TRANSCEIVER_CHECK_TEXT[echo].hint : 'Not reported by this firmware'}>
                      {echo === null ? (
                        <span className="muted">not reported</span>
                      ) : (
                        <StatusLabel tone={echo === 'ok' ? 'ok' : echo === 'not_run' ? 'muted' : 'bad'}>
                          {TRANSCEIVER_CHECK_TEXT[echo].label}
                        </StatusLabel>
                      )}
                    </td>
                    <td className={s && s.configStatus !== 'VERIFIED' ? 'tone-warn small' : 'small'}>
                      {s ? s.configStatus.toLowerCase().replace(/_/g, ' ') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        Transceiver echo: at start-up each board pulses its TX pin and checks that RX follows. It proves the TX/RX wiring and
        transceiver power, not CANH/CANL or termination.
      </p>
    </section>
  );
}
