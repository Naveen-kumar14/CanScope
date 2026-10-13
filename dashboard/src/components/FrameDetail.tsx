import { decodeFrame } from '../lib/decoder';
import { BUS_STATE_LABEL, hexByte } from '../lib/format';
import type { StoredFrame } from '../types/events';
import { DecoderStatusBadge } from './DecoderStatusBadge';

export function FrameDetail({ frame }: { frame: StoredFrame | null }) {
  if (!frame) {
    return (
      <aside className="card detail" aria-label="Frame detail">
        <h2>Frame detail</h2>
        <p className="muted">Select a frame to inspect it.</p>
      </aside>
    );
  }
  const decoded = decodeFrame(frame);
  return (
    <aside className="card detail" aria-label="Frame detail" data-testid="frame-detail">
      <h2>
        Frame {frame.canId} <DecoderStatusBadge status={decoded.status} />
      </h2>
      {frame.origin === 'mock' && <p className="badge badge-mock">MOCK frame</p>}
      <dl>
        <dt>Timestamp (host)</dt>
        <dd className="mono">{frame.timestamp}</dd>
        <dt>Device time</dt>
        <dd className="mono">{frame.deviceTimeUs !== undefined ? `${frame.deviceTimeUs} µs` : '—'}</dd>
        <dt>Captured by</dt>
        <dd>{frame.sourceNode}</dd>
        <dt>Identifier</dt>
        <dd className="mono">
          {frame.canId} ({frame.identifierFormat}
          {frame.remote ? ', remote frame' : ''})
        </dd>
        <dt>DLC</dt>
        <dd>{frame.dlc}</dd>
        <dt>Payload</dt>
        <dd className="mono">
          {frame.data.length === 0
            ? '—'
            : frame.data.map((b, i) => (
                <span key={i} className="byte" title={`byte ${i} = ${b}`}>
                  {hexByte(b)}
                </span>
              ))}
        </dd>
        <dt>Bus state</dt>
        <dd>{BUS_STATE_LABEL[frame.busState]}</dd>
        <dt>TEC / REC</dt>
        <dd>
          {frame.txErrorCount ?? '—'} / {frame.rxErrorCount ?? '—'}
        </dd>
      </dl>

      <h3>Decoder</h3>
      {decoded.entry === null ? (
        <p className="muted">No registry entry for this ID. Raw frame kept; nothing is inferred.</p>
      ) : (
        <>
          <p>
            <strong>{decoded.entry.name}</strong> · status <code>{decoded.entry.status}</code>
            <br />
            <span className="muted small">Evidence: {decoded.entry.evidence}</span>
          </p>
          {decoded.status === 'mismatch' && (
            <p className="tone-warn">Frame does not match its registry entry: {decoded.reason}</p>
          )}
          {decoded.fields.length > 0 && (
            <table className="fields">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Raw</th>
                  <th>Physical</th>
                </tr>
              </thead>
              <tbody>
                {decoded.fields.map((f) => (
                  <tr key={f.name}>
                    <td className="mono">{f.name}</td>
                    <td className="mono">{f.raw}</td>
                    <td>
                      {f.physical !== null ? (
                        `${f.physical} ${f.unit ?? ''}`
                      ) : (
                        <span className="tone-warn">not shown — scaling/units unverified</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </aside>
  );
}
