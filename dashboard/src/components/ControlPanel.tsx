import { useState } from 'react';

import { COMMAND_PARAMS, nodeLabel, physicalRange, unitLabel, validateCommandValue, type CommandParam } from '../lib/protocol';
import { DEMO_FAULTS, PROFILES } from '../lib/protocol-spec.generated';
import type { CommandRecord } from '../lib/serial/command-tracker';
import { isDisplayCommand } from '../lib/serial/oled-sync';
import type { DeviceNode, EcuNode } from '../types/events';

interface Props {
  /** null in mock mode: there is no physical node to command. */
  send: ((node: DeviceNode, text: string) => Promise<CommandRecord>) | null;
  connected: Record<DeviceNode, boolean>;
  commands: readonly CommandRecord[];
  nowMs: number;
}

export function ControlPanel({ send, connected, commands, nowMs }: Props) {
  if (!send) {
    return (
      <section className="card" aria-label="Controls" data-testid="controls">
        <h2>Controls</h2>
        <p className="muted" data-testid="controls-unavailable">
          Unavailable with mock data. Commands need a physical node connected over USB serial (physical mode).
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Controls" data-testid="controls">
      <h2>Controls</h2>
      <p className="small muted">
        Commands go to the addressed board over its own USB port, are validated there again, and count as applied only
        when that board acknowledges them. They do not put arbitrary frames on the CAN bus.
      </p>
      <div className="control-grid">
        {(['node1', 'node2'] as EcuNode[]).map((n) => (
          <EcuControls key={n} node={n} send={send} connected={connected[n]} />
        ))}
        <MonitorControls send={send} connected={connected.monitor} />
      </div>
      <CommandLog commands={commands} nowMs={nowMs} />
    </section>
  );
}

function Offline({ node }: { node: DeviceNode }) {
  return (
    <p className="small tone-warn" data-testid={`offline-${node}`}>
      Disabled: {nodeLabel(node)} USB port is not connected and identified.
    </p>
  );
}

function EcuControls({ node, send, connected }: { node: EcuNode; send: NonNullable<Props['send']>; connected: boolean }) {
  const params = COMMAND_PARAMS.filter((p) => p.node === node);
  const [fault, setFault] = useState<string>(DEMO_FAULTS[0].name);
  const [profile, setProfile] = useState<string>(PROFILES[0]);
  return (
    <article className="card control-card" data-testid={`controls-${node}`}>
      <h3>{nodeLabel(node)}</h3>
      {!connected && <Offline node={node} />}
      <fieldset disabled={!connected}>
        <legend className="small muted">Sensor values</legend>
        {params.map((p) => (
          <ValueControl key={p.param} param={p} send={send} />
        ))}
      </fieldset>
      <fieldset disabled={!connected}>
        <legend className="small muted">Generation profile</legend>
        <div className="row">
          <select aria-label={`${node} profile`} value={profile} onChange={(e) => setProfile(e.target.value)}>
            {PROFILES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void send(node, `profile ${profile}`)}>
            Apply profile
          </button>
        </div>
      </fieldset>
      <fieldset disabled={!connected}>
        <legend className="small muted">Fault injection (changes what this ECU transmits)</legend>
        <div className="row">
          <select aria-label={`${node} fault to inject`} value={fault} onChange={(e) => setFault(e.target.value)}>
            {DEMO_FAULTS.map((d) => (
              <option key={d.name} value={d.name} title={d.description}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="button" data-testid={`inject-${node}`} onClick={() => void send(node, `fault ${fault}`)}>
            Inject
          </button>
          <button type="button" data-testid={`clear-${node}`} onClick={() => void send(node, 'fault clear')}>
            Clear fault
          </button>
        </div>
      </fieldset>
      <fieldset disabled={!connected}>
        <legend className="small muted">Node</legend>
        <div className="row">
          <button type="button" onClick={() => void send(node, 'status')}>
            Request status
          </button>
          <button type="button" title="Only accepted while this ECU's controller is bus-off" onClick={() => void send(node, 'recover')}>
            Recover from bus-off
          </button>
        </div>
      </fieldset>
    </article>
  );
}

function ValueControl({ param, send }: { param: CommandParam; send: NonNullable<Props['send']> }) {
  const range = physicalRange(param.field);
  const [text, setText] = useState(((param.field.default ?? 0) * param.field.factor).toFixed(param.field.decimals));
  const [error, setError] = useState<string | null>(null);
  const unit = unitLabel(param.field.unit);
  const submit = () => {
    const check = validateCommandValue(param, text);
    if (!check.ok) {
      setError(check.reason);  // nothing is sent
      return;
    }
    setError(null);
    void send(param.node, `set ${param.param} ${check.text}`);
  };
  return (
    <div className="value-control">
      <label>
        {param.param}{' '}
        <span className="muted small">
          ({range.min}..{range.max} {unit})
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          aria-label={`${param.node} ${param.param}`}
          aria-invalid={error !== null}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      <button type="button" onClick={submit} data-testid={`send-${param.node}-${param.param}`}>
        Set
      </button>
      {error && (
        <span className="tone-bad small" role="alert" data-testid={`error-${param.node}-${param.param}`}>
          Not sent: {error}
        </span>
      )}
    </div>
  );
}

function MonitorControls({ send, connected }: { send: NonNullable<Props['send']>; connected: boolean }) {
  return (
    <article className="card control-card" data-testid="controls-monitor">
      <h3>{nodeLabel('monitor')}</h3>
      {!connected && <Offline node="monitor" />}
      <fieldset disabled={!connected}>
        <div className="row">
          <button type="button" onClick={() => void send('monitor', 'frames on')}>
            Raw frames on
          </button>
          <button type="button" onClick={() => void send('monitor', 'frames off')}>
            Raw frames off
          </button>
        </div>
        <div className="row">
          <button type="button" onClick={() => void send('monitor', 'status')}>
            Request status
          </button>
          <button type="button" onClick={() => void send('monitor', 'recover')} title="Only accepted while the monitor's controller is bus-off">
            Recover from bus-off
          </button>
        </div>
      </fieldset>
    </article>
  );
}

const STATE_LABEL: Record<CommandRecord['state'], string> = {
  pending: 'waiting for ack',
  ok: 'acknowledged',
  rejected: 'rejected',
  unsupported: 'unsupported',
  timeout: 'timeout',
  not_sent: 'not sent',
  connection_lost: 'connection lost',
};

const STATE_TONE: Record<CommandRecord['state'], string> = {
  pending: 'warn',
  ok: 'ok',
  rejected: 'bad',
  unsupported: 'bad',
  timeout: 'bad',
  not_sent: 'muted',
  connection_lost: 'bad',
};

/**
 * Detail for a "display" command to Node 3: a short OLED result once Node 3
 * acknowledged it ok, otherwise the actual reason (device detail or local failure).
 */
function displayDetail(c: CommandRecord): string {
  if (c.state !== 'ok') return c.detail;
  return /^display clear( |$)/.test(c.text) ? 'OLED cleared' : 'OLED updated';
}

export function CommandLog({ commands, nowMs }: { commands: readonly CommandRecord[]; nowMs: number }) {
  return (
    <div className="card command-log" data-testid="command-log">
      <h3>Command log</h3>
      {commands.length === 0 ? (
        <p className="muted small">No commands sent.</p>
      ) : (
        <div className="table-wrap short">
          <table>
            <thead>
              <tr>
                <th>Sent</th>
                <th>Node</th>
                <th>Command</th>
                <th>Result</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {commands.slice(0, 30).map((c) => (
                <tr key={c.id} data-testid={`cmd-${c.id}`}>
                  <td className="mono small">{Math.max(0, Math.round((nowMs - c.sentAtMs) / 1000))} s ago</td>
                  <td>{c.node}</td>
                  <td className="mono">{c.text}</td>
                  <td className={`tone-${STATE_TONE[c.state]}`} data-testid={`cmd-state-${c.id}`}>
                    <strong>{STATE_LABEL[c.state]}</strong>
                    {c.resolvedAtMs !== null && c.state !== 'not_sent' && (
                      <span className="muted small"> {c.resolvedAtMs - c.sentAtMs} ms</span>
                    )}
                  </td>
                  <td className="small" data-testid={`cmd-detail-${c.id}`}>
                    {isDisplayCommand(c.text) ? displayDetail(c) : c.detail}
                    {c.lateAck && <span className="tone-warn"> (late reply: {c.lateAck})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
