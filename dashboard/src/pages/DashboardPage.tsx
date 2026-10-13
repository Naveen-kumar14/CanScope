import { useMemo, useState } from 'react';

import { BusSummary } from '../components/BusSummary';
import { FrameDetail } from '../components/FrameDetail';
import { FrameFilters } from '../components/FrameFilters';
import { FrameTable } from '../components/FrameTable';
import { NodeHealthCards } from '../components/NodeHealthCards';
import { StateBanner } from '../components/StateBanner';
import { StatusBar } from '../components/StatusBar';
import {
  frameRate,
  overallBusState,
  totalCounters,
  viewState,
} from '../lib/dashboard-state';
import type { CanDataSource } from '../lib/data-source';
import { DEFAULT_FILTER, filterFrames, type FrameFilter } from '../lib/filters';
import { useCanScope } from '../lib/use-can-scope';

interface Props {
  source: CanDataSource;
  /** Extra header controls, e.g. the mock scenario picker. Never a CAN command. */
  headerExtras?: React.ReactNode;
}

export function DashboardPage({ source, headerExtras }: Props) {
  const { state, nowMs } = useCanScope(source);
  const [filter, setFilter] = useState<FrameFilter>(DEFAULT_FILTER);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

  const view = viewState(state, nowMs);
  const nodeNames = useMemo(() => Object.keys(state.nodes).sort(), [state.nodes]);
  const filtered = useMemo(() => filterFrames(state.frames, filter, nowMs), [state.frames, filter, nowMs]);
  const selected = state.frames.find((f) => f.seq === selectedSeq) ?? null;
  const notCurrent = view === 'stale' || view === 'disconnected' || view === 'error';

  return (
    <div className="app">
      <StatusBar origin={state.sourceKind} sourceLabel={state.sourceLabel} connection={state.connection}>
        {headerExtras}
      </StatusBar>
      <main>
        <StateBanner
          view={view}
          origin={state.sourceKind}
          detail={state.connectionDetail}
          lastEventAgeMs={state.lastEventMs === null ? null : nowMs - state.lastEventMs}
        />
        <BusSummary
          busState={overallBusState(state.nodes)}
          frameRate={view === 'live' ? frameRate(state.frames, nowMs) : 0}
          counters={totalCounters(state.nodes)}
          bufferedFrames={state.frames.length}
          droppedFromView={state.droppedFromView}
          dimmed={notCurrent}
        />
        <NodeHealthCards nodes={state.nodes} nowMs={nowMs} />
        <section className="frames-layout" aria-label="Raw CAN frames">
          <div className={`card frames-card ${notCurrent ? 'dimmed' : ''}`}>
            <h2>Latest raw frames</h2>
            <FrameFilters filter={filter} nodes={nodeNames} onChange={setFilter} />
            {state.frames.length === 0 ? (
              <p className="muted" data-testid="frames-none">No frames received.</p>
            ) : (
              <FrameTable frames={filtered} selectedSeq={selectedSeq} onSelect={setSelectedSeq} />
            )}
          </div>
          <FrameDetail frame={selected} />
        </section>
      </main>
      <footer className="footer muted small">
        CANScope dashboard is monitoring-only: it cannot transmit CAN frames, send commands or control
        outputs. Unverified IDs and values are labelled and never shown as physical quantities.
      </footer>
    </div>
  );
}
