import { decodeFrame } from '../lib/decoder';
import { formatPayload, formatTime } from '../lib/format';
import type { StoredFrame } from '../types/events';
import { DecoderStatusBadge } from './DecoderStatusBadge';

export const MAX_ROWS = 200;

interface Props {
  frames: StoredFrame[]; // already filtered, oldest first
  selectedSeq: number | null;
  onSelect: (seq: number) => void;
}

export function FrameTable({ frames, selectedSeq, onSelect }: Props) {
  const rows = frames.slice(-MAX_ROWS).reverse();
  if (rows.length === 0) {
    return <p className="muted" data-testid="frames-empty">No frames match.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="frames" data-testid="frame-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Node</th>
            <th>CAN ID</th>
            <th>Format</th>
            <th>DLC</th>
            <th>Data</th>
            <th>Decoder</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr
              key={f.seq}
              className={f.seq === selectedSeq ? 'selected' : ''}
              onClick={() => onSelect(f.seq)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(f.seq)}
              tabIndex={0}
              aria-selected={f.seq === selectedSeq}
            >
              <td className="mono">{formatTime(f.timestamp)}</td>
              <td>{f.sourceNode}</td>
              <td className="mono">{f.canId}</td>
              <td>{f.identifierFormat === 'extended' ? 'ext' : 'std'}{f.remote ? ' RTR' : ''}</td>
              <td>{f.dlc}</td>
              <td className="mono">{formatPayload(f.data)}</td>
              <td>
                <DecoderStatusBadge status={decodeFrame(f).status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {frames.length > MAX_ROWS && (
        <p className="muted small">Showing newest {MAX_ROWS} of {frames.length} matching frames.</p>
      )}
    </div>
  );
}
