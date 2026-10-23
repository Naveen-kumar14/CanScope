import { sortedActiveFaults, type DashboardState } from '../lib/dashboard-state';
import { formatAge, formatTime } from '../lib/format';
import { demoFault, expectedDetections, faultInfo, nodeLabel } from '../lib/protocol';
import type { EcuNode, FaultSeverity } from '../types/events';
import { StatusIcon, StatusLabel, type StatusTone } from './StatusIcon';

const SNAPSHOT_STALE_MS = 3000;
const SEVERITY_TONE: Record<FaultSeverity, StatusTone> = { critical: 'bad', warning: 'warn', info: 'muted' };

interface Props {
  state: DashboardState;
  nowMs: number;
  /**
   * Node 3 is connected and reporting now. When it is not, detection status
   * is unknown: the last list is shown greyed, never as "no faults".
   */
  monitorOnline: boolean;
}

/** Faults raised and cleared by Node 3's own detection (the pass criterion). */
export function DetectedFaults({ state, nowMs, monitorOnline }: Props) {
  const active = sortedActiveFaults(state.activeFaults);
  const monitorSeen = !!state.nodes.monitor;
  const snapshotAge = state.lastSnapshotMs === null ? null : nowMs - state.lastSnapshotMs;
  const snapshotStale = snapshotAge === null || snapshotAge > SNAPSHOT_STALE_MS;

  return (
    <section className="card" aria-labelledby="detected-title" data-testid="detected-faults">
      <div className="card-head">
        <h2 id="detected-title">Faults detected by Node 3</h2>
        {monitorOnline && (
          <span className={`small ${snapshotStale ? 'tone-warn' : 'muted'}`} data-testid="fault-snapshot-age">
            {snapshotAge === null ? 'no fault list received yet' : `list updated ${formatAge(snapshotAge)}`}
            {snapshotStale && snapshotAge !== null && ' — may be out of date'}
          </span>
        )}
      </div>
      <p className="card-intro">Raised and cleared by the monitor from frames it actually received and from its own controller state.</p>
      {!monitorOnline ? (
        <p data-testid="faults-unavailable">
          <StatusLabel tone="muted">
            {monitorSeen
              ? 'Node 3 is not reporting: fault detection status is unknown (not "no faults"). The last known list is shown greyed.'
              : 'Node 3 is not connected: fault detection status is unknown (not "no faults").'}
          </StatusLabel>
        </p>
      ) : active.length === 0 && state.lastSnapshotMs === null && state.faultHistory.length === 0 ? (
        <p data-testid="faults-waiting">
          <StatusLabel tone="muted">Waiting for Node 3’s first fault list (sent once per second).</StatusLabel>
        </p>
      ) : active.length === 0 ? (
        <p data-testid="faults-none">
          <StatusLabel tone="ok">No active faults reported by Node 3.</StatusLabel>
        </p>
      ) : null}
      {active.length > 0 && (monitorOnline || monitorSeen) && (
        <div className={`table-wrap ${monitorOnline ? '' : 'dimmed'}`}>
          <table className="data-table faults" data-testid="active-faults">
            <caption className="visually-hidden">Active faults, most severe first</caption>
            <thead>
              <tr>
                <th scope="col">Severity</th>
                <th scope="col">Node</th>
                <th scope="col">Fault</th>
                <th scope="col">Detail</th>
                <th scope="col">Active since</th>
              </tr>
            </thead>
            <tbody>
              {active.map((f) => (
                <tr key={`${f.code}@${f.node}`} data-testid={`fault-${f.code}-${f.node}`}>
                  <td>
                    <StatusLabel tone={SEVERITY_TONE[f.severity]}>{f.severity}</StatusLabel>
                  </td>
                  <td>{nodeLabel(f.node)}</td>
                  <td>
                    <code>{f.code}</code>
                    {faultInfo(f.code)?.description && <div className="small muted">{faultInfo(f.code)?.description}</div>}
                  </td>
                  <td className="small">{f.detail}</td>
                  <td className="small mono">
                    {formatTime(new Date(f.sinceMs).toISOString())} <span className="muted">({formatAge(nowMs - f.sinceMs)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.snapshotTruncated && (
        <p className="small">
          <StatusLabel tone="warn">More faults are active than one snapshot line lists; see the OLED faults page.</StatusLabel>
        </p>
      )}

      <h3 className="subhead">Recent fault events</h3>
      {state.faultHistory.length === 0 ? (
        <p className="muted small">None this session.</p>
      ) : (
        <div className="table-wrap short">
          <table className="data-table faults" data-testid="fault-history">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Event</th>
                <th scope="col">Node</th>
                <th scope="col">Fault</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {state.faultHistory.slice(0, 40).map((h) => (
                <tr key={h.key}>
                  <td className="mono small">{formatTime(new Date(h.atMs).toISOString())}</td>
                  <td>
                    {h.code === 'MONITOR_RESTARTED' ? (
                      <StatusLabel tone="info">restart</StatusLabel>
                    ) : h.state === 'active' ? (
                      <StatusLabel tone={SEVERITY_TONE[h.severity]}>raised</StatusLabel>
                    ) : (
                      <StatusLabel tone="ok">recovered</StatusLabel>
                    )}
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
    </section>
  );
}

/** What each ECU says it was asked to do, next to what Node 3 detected. */
export function CommandedFaults({ state, monitorOnline }: Omit<Props, 'nowMs'>) {
  const commanded = (['node1', 'node2'] as EcuNode[])
    .map((n) => ({ node: n, s: state.ecuStates[n] }))
    .filter((x) => x.s && x.s.event.demoFault !== 'none');

  return (
    <section className="card commanded" aria-labelledby="commanded-title" data-testid="commanded-faults">
      <h2 id="commanded-title">Requested faults vs. detection</h2>
      <p className="card-intro">
        <strong>Fault requested</strong> is what the ECU reports about itself. <strong>Fault detected</strong> appears only
        when Node 3 independently sees the effect on the bus.
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
                <strong>{nodeLabel(node)}</strong> — fault requested: <code>{name}</code>
                <br />
                <span className="small muted">{demoFault(name)?.description ?? 'unknown demo fault'}</span>
              </p>
              <ul className="check-list">
                {expected.map((code) => {
                  // A stale list from a disconnected Node 3 is not a detection.
                  const hit = monitorOnline && state.activeFaults.some((f) => f.code === code && f.node === node);
                  const tone: StatusTone = hit ? 'ok' : monitorOnline ? 'warn' : 'muted';
                  return (
                    <li key={code} data-testid={`expect-${node}-${code}`}>
                      <StatusIcon tone={tone} /> <code>{code}</code>:{' '}
                      <span className={`tone-${tone}`}>
                        {hit ? 'detected by Node 3' : monitorOnline ? 'not detected (yet)' : 'unknown — Node 3 not connected'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
