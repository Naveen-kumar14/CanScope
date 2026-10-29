import { exampleFrames } from '../lib/example-frames';
import { formatPayload } from '../lib/format';

const ROWS = exampleFrames();

/**
 * Message-format examples shown while Node 3 has reported no frame. Static and
 * presentation only: no time, no source node and no Node 3 verdict, because
 * nothing here was received.
 */
export function ExampleFrames() {
  return (
    <div className="example-frames" data-testid="example-frames">
      <p className="small muted" data-testid="example-frames-note">
        <strong>Example frames</strong>: the format of each message, built from the protocol definition. Not received from
        the bus; real frames from Node 3 replace this list.
      </p>
      <div className="table-wrap">
        <table className="frames" data-testid="example-frame-table">
          <thead>
            <tr>
              <th>CAN ID</th>
              <th>Format</th>
              <th>DLC</th>
              <th>Data</th>
              <th>Message</th>
              <th>Values</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((f) => (
              <tr key={f.canId} data-testid={`example-${f.canId}`}>
                <td className="mono">{f.canId}</td>
                <td>std</td>
                <td>{f.dlc}</td>
                <td className="mono">{formatPayload(f.data)}</td>
                <td>{f.message}</td>
                <td className="small">{f.values}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
