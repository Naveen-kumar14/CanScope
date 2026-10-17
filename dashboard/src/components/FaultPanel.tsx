import { sortedActiveFaults, type DashboardState } from '../lib/dashboard-state';
import { formatAge, formatTime } from '../lib/format';
import { demoFault, expectedDetections, faultInfo, nodeLabel } from '../lib/protocol';
import type { EcuNode, FaultSeverity } from '../types/events';

interface Props {
  state: DashboardState;
  nowMs: number;
}

const SNAPSHOT_STALE_MS = 3000;
const SEVERITY_TONE: Record<FaultSeverity, string> = { critical: 'bad', warning: 'warn', info: 'muted' };

export function FaultPanel({ state, nowMs }: Props) {
  const active = sortedActiveFaults(state.activeFaults);
  const monitorSeen = !!state.nodes.monitor;
  const snapshotAge = state.lastSnapshotMs === null ? null : nowMs - state.lastSnapshotMs;
  const snapshotStale = snapshotAge === null || snapshotAge > SNAPSHOT_STALE_MS;
  const commanded = (['node1', 'node2'] as EcuNode[])
    .map((n) => ({ node: n, s: state.ecuStates[n] }))
    .filter((x) => x.s && x.s.event.demoFault !== 'none');

  return (
    <section className="fault-layout" aria-label="Faults">
      <div className="card" data-testid="detected-faults">
        <div className="row-between">
          <h2>Faults detected by Node 3</h2>
          {monitorSeen && (
            <span className={`small ${snapshotStale ? 'tone-warn' : 'muted'}`} data-testid="fault-snapshot-age">
              {snapshotAge === null ? 'no fault list received yet' : `fault list ${formatAge(snapshotAge)}`}
              {snapshotStale && snapshotAge !== null && ' — may be out of date'}
            </span>
          )}
        </div>
        <p className="small muted">
          Raised and cleared by the monitor from CAN frames it actually received and from its own controller state.
        </p>
        {!monitorSeen ? (
          <p className="muted" data-testid="faults-unavailable">
            Node 3 is not connected: fault detection status is unknown (not "no faults").
          </p>
        ) : active.length === 0 ? (
          <p className="tone-ok" data-testid="faults-none">
            No active faults reported by Node 3.
          </p>
        ) : (
          <table className="faults" data-testid="active-faults">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Node</th>
                <th>Fault</th>
                <th>Detail</th>
                <th>Active since</th>
              </tr>
            </thead>
            <tbody>
              {active.map((f) => (
                <tr key={`${f.code}@${f.node}`} data-testid={`fault-${f.code}-${f.node}`}>
                  <td className={`tone-${SEVERITY_TONE[f.severity]}`}>
                    <strong>{f.severity}</strong>
                  </td>
                  <td>{f.node}</td>
                  <td className="mono" title={faultInfo(f.code)?.description}>
                    {f.code}
                  </td>
                  <td className="small">{f.detail}</td>
                  <td className="small mono">
                    {formatTime(new Date(f.sinceMs).toISOString())} <span className="muted">({formatAge(nowMs - f.sinceMs)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {state.snapshotTruncated && (
          <p className="tone-warn small">More faults are active than one snapshot line lists; see the OLED faults page.</p>
        )}

        <h3>Recent fault events</h3>
        {state.faultHistory.length === 0 ? (
          <p className="muted small">None this session.</p>
        ) : (
          <div className="table-wrap short">
            <table className="faults" data-testid="fault-history">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Node</th>
                  <th>Fault</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {state.faultHistory.slice(0, 40).map((h) => (
                  <tr key={h.key}>
                    <td className="mono small">{formatTime(new Date(h.atMs).toISOString())}</td>
                    <td className={h.state === 'active' ? `tone-${SEVERITY_TONE[h.severity]}` : 'tone-ok'}>
                      {h.code === 'MONITOR_RESTARTED' ? 'restart' : h.state === 'active' ? 'raised' : 'recovered'}
                    </td>
                    <td>{h.node}</td>
                    <td className="mono">{h.code}</td>
                    <td className="small">{h.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card commanded" data-testid="commanded-faults">
        <h2>Commanded demo faults</h2>
        <p className="small muted">
          Reported by each ECU about itself. A commanded fault is not a detection: the column on the right shows only
          what Node 3 has independently detected.
        </p>
        {commanded.length === 0 ? (
          <p className="muted small" data-testid="commanded-none">
            No ECU reports an active demo fault.
          </p>
        ) : (
          commanded.map(({ node, s }) => {
            const name = s!.event.demoFault;
            const expected = expectedDetections(name);
            return (
              <div key={node} className="commanded-item" data-testid={`commanded-${node}`}>
                <p>
                  <strong>{nodeLabel(node)}</strong>: <code>{name}</code>
                  <br />
                  <span className="small muted">{demoFault(name)?.description ?? 'unknown demo fault'}</span>
                </p>
                <ul className="small">
                  {expected.map((code) => {
                    const hit = state.activeFaults.some((f) => f.code === code && f.node === node);
                    return (
                      <li key={code} data-testid={`expect-${node}-${code}`} className={hit ? 'tone-ok' : 'tone-warn'}>
                        {code}: {hit ? 'detected by Node 3' : monitorSeen ? 'not detected (yet)' : 'unknown — Node 3 not connected'}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
