import type { Counters } from '../lib/dashboard-state';
import { BUS_STATE_LABEL, BUS_STATE_TONE } from '../lib/format';
import type { BusState } from '../types/events';

interface Props {
  busState: BusState;
  frameRate: number;
  counters: Counters;
  bufferedFrames: number;
  droppedFromView: number;
  dimmed: boolean;
}

export function BusSummary({ busState, frameRate, counters, bufferedFrames, droppedFromView, dimmed }: Props) {
  return (
    <section className={`card summary ${dimmed ? 'dimmed' : ''}`} aria-label="Bus summary">
      <div className="metric">
        <span className="metric-label">Bus state</span>
        <span className={`metric-value tone-${BUS_STATE_TONE[busState]}`} data-testid="bus-state">
          {BUS_STATE_LABEL[busState]}
        </span>
      </div>
      <div className="metric">
        <span className="metric-label">Frame rate</span>
        <span className="metric-value" data-testid="frame-rate">
          {frameRate.toFixed(0)} <small>frames/s</small>
        </span>
      </div>
      <div className="metric">
        <span className="metric-label">RX (node counters)</span>
        <span className="metric-value" data-testid="counter-rx">{counters.rx}</span>
      </div>
      <div className="metric">
        <span className="metric-label">TX</span>
        <span className="metric-value" data-testid="counter-tx">{counters.tx}</span>
      </div>
      <div className="metric">
        <span className="metric-label">Bus errors</span>
        <span className={`metric-value ${counters.errors ? 'tone-warn' : ''}`} data-testid="counter-errors">
          {counters.errors}
        </span>
      </div>
      <div className="metric">
        <span className="metric-label">Bus-off events</span>
        <span className={`metric-value ${counters.busOff ? 'tone-bad' : ''}`} data-testid="counter-busoff">
          {counters.busOff}
        </span>
      </div>
      <div className="metric">
        <span className="metric-label">RX missed</span>
        <span className={`metric-value ${counters.rxMissed ? 'tone-warn' : ''}`}>{counters.rxMissed}</span>
      </div>
      <div className="metric">
        <span className="metric-label">Buffered frames</span>
        <span className="metric-value">
          {bufferedFrames}
          {droppedFromView > 0 && <small> ({droppedFromView} older evicted)</small>}
        </span>
      </div>
    </section>
  );
}
