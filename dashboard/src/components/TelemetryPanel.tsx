import { telemetryView, type DashboardState } from '../lib/dashboard-state';
import { formatAge } from '../lib/format';
import { fieldByKey, formatPhysical, nodeLabel, unitLabel } from '../lib/protocol';
import { ECU_COMMANDS } from '../lib/protocol-spec.generated';
import type { EcuNode } from '../types/events';

interface Props {
  state: DashboardState;
  nowMs: number;
  /** Physical mode: whether each ECU's own USB port is connected. */
  ecuConnected: Partial<Record<EcuNode, boolean>>;
}

const ECUS: EcuNode[] = ['node1', 'node2'];
const SELF_REPORT_STALE_MS = 3000;

function fieldsOf(node: EcuNode): string[] {
  return ECU_COMMANDS[node].map((c) => c.field);
}

export function TelemetryPanel({ state, nowMs, ecuConnected }: Props) {
  return (
    <section aria-label="ECU telemetry">
      <h2>ECU telemetry</h2>
      <div className="telemetry-grid">
        {ECUS.map((node) => (
          <EcuCard key={node} node={node} state={state} nowMs={nowMs} usbConnected={ecuConnected[node]} />
        ))}
      </div>
    </section>
  );
}

function EcuCard({ node, state, nowMs, usbConnected }: { node: EcuNode; state: DashboardState; nowMs: number; usbConnected?: boolean }) {
  const view = telemetryView(state, node, nowMs);
  const health = state.health[node];
  const self = state.ecuStates[node];
  const keys = fieldsOf(node);
  const selfStale = self ? nowMs - self.receivedAtMs > SELF_REPORT_STALE_MS : false;

  return (
    <article className="card ecu-card" data-testid={`ecu-${node}`}>
      <h3>{nodeLabel(node)}</h3>

      <div className="observed" data-testid={`observed-${node}`}>
        <div className="row-between">
          <span className="section-label">Observed on CAN by Node 3</span>
          {view.kind === 'current' && <span className="badge tone-ok">current</span>}
          {view.kind === 'stale' && <span className="badge badge-warn">stale</span>}
          {view.kind === 'unavailable' && <span className="badge">unavailable</span>}
        </div>
        {view.kind === 'unavailable' ? (
          <p className="muted small" data-testid={`observed-${node}-unavailable`}>
            {view.reason}
          </p>
        ) : (
          <>
            <div className={`values ${view.kind === 'stale' ? 'dimmed' : ''}`}>
              {keys.map((k) => (
                <div className="value" key={k}>
                  <span className="value-num" data-testid={`obs-${node}-${k}`}>
                    {formatPhysical(k, view.event.values[k])}
                  </span>
                  <span className="value-unit">{unitLabel(fieldByKey(k)?.unit ?? '')}</span>
                  <span className="value-key muted small">{k}</span>
                </div>
              ))}
            </div>
            <p className="small muted">
              last valid frame {formatAge(view.ageMs)} · counter {view.event.counter}
              {view.reason && <span className="tone-warn"> · {view.reason}</span>}
            </p>
          </>
        )}
        {health && (
          <p className="small" data-testid={`health-${node}`}>
            Heartbeat <LinkWord s={health.event.heartbeat} /> · telemetry <LinkWord s={health.event.telemetry} />
            {health.event.firmware && (
              <span className="muted">
                {' '}
                · fw {health.event.firmware} · protocol v{health.event.protocolVersion}
                {!health.event.versionOk && <span className="tone-bad"> (unsupported)</span>}
              </span>
            )}
            {health.event.ecuCanState && <span className="muted"> · ECU CAN {health.event.ecuCanState}</span>}
            <br />
            <span className="muted">
              rejected {health.event.stats.rejectedFrames ?? 0} · DLC {health.event.stats.dlcErrors ?? 0} · checksum{' '}
              {health.event.stats.checksumErrors ?? 0} · range {health.event.stats.rangeErrors ?? 0} · gaps{' '}
              {health.event.stats.sequenceGaps ?? 0}
            </span>
          </p>
        )}
      </div>

      <div className="self-report" data-testid={`self-${node}`}>
        <span className="section-label">Reported by the ECU over its own USB (commanded)</span>
        {!self ? (
          <p className="muted small">
            {usbConnected === false || usbConnected === undefined
              ? `${nodeLabel(node)} USB port not connected: commanded state unknown.`
              : 'Waiting for the ECU state report…'}
          </p>
        ) : (
          <div className={selfStale ? 'dimmed' : ''}>
            <table className="mini">
              <thead>
                <tr>
                  <th />
                  {keys.map((k) => (
                    <th key={k}>
                      {k} <span className="muted">({unitLabel(fieldByKey(k)?.unit ?? '')})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="muted">setpoint</td>
                  {keys.map((k) => (
                    <td key={k} className="mono" data-testid={`set-${node}-${k}`}>
                      {formatPhysical(k, self.event.setpoint[k])}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="muted">sent</td>
                  {keys.map((k) => (
                    <td key={k} className="mono">
                      {formatPhysical(k, self.event.sent[k])}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="small muted">
              profile {self.event.profile} · injected fault{' '}
              <strong className={self.event.demoFault !== 'none' ? 'tone-warn' : ''}>{self.event.demoFault}</strong> · CAN{' '}
              {self.event.canRunning ? self.event.busState : <span className="tone-bad">not running</span>} · TX ok{' '}
              {self.event.txOk} / failed <span className={self.event.txFailed ? 'tone-warn' : ''}>{self.event.txFailed}</span>
              {selfStale && <span className="tone-warn"> · report {formatAge(nowMs - self.receivedAtMs)}</span>}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function LinkWord({ s }: { s: string }) {
  const tone = s === 'ok' ? 'ok' : s === 'lost' ? 'bad' : 'muted';
  return <strong className={`tone-${tone}`}>{s}</strong>;
}
