import { useMemo, useState, useSyncExternalStore } from 'react';

import { BusSummary } from '../components/BusSummary';
import { ConnectionPanel } from '../components/ConnectionPanel';
import { ControlPanel } from '../components/ControlPanel';
import { FaultPanel } from '../components/FaultPanel';
import { FrameDetail } from '../components/FrameDetail';
import { FrameFilters } from '../components/FrameFilters';
import { FrameTable } from '../components/FrameTable';
import { NodeHealthCards } from '../components/NodeHealthCards';
import { SelftestCard } from '../components/SelftestCard';
import { StateBanner } from '../components/StateBanner';
import { StatusBar } from '../components/StatusBar';
import { TelemetryPanel } from '../components/TelemetryPanel';
import { frameRate, overallBusState, totalCounters, viewState } from '../lib/dashboard-state';
import type { CanDataSource } from '../lib/data-source';
import { DEFAULT_FILTER, filterFrames, type FrameFilter } from '../lib/filters';
import type { PhysicalSnapshot, PhysicalSource } from '../lib/serial/physical-source';
import { useCanScope } from '../lib/use-can-scope';
import type { DeviceNode } from '../types/events';

interface Props {
  source: CanDataSource;
  /** Present in physical mode: USB links and the command channel. */
  physical?: PhysicalSource;
  /** Extra header controls, e.g. the data-source picker. */
  headerExtras?: React.ReactNode;
  /** Event batching interval (0 = dispatch every event at once; tests). */
  flushMs?: number;
}

const NO_PHYSICAL: PhysicalSnapshot = { supported: false, unsupportedReason: null, links: [], commands: [] };
const subscribeNone = () => () => undefined;
const getNone = () => NO_PHYSICAL;

export function DashboardPage({ source, physical, headerExtras, flushMs = 100 }: Props) {
  const { state, nowMs } = useCanScope(source, 500, flushMs);
  const snapshot = useSyncExternalStore(physical?.subscribe ?? subscribeNone, physical?.getSnapshot ?? getNone);
  const [filter, setFilter] = useState<FrameFilter>(DEFAULT_FILTER);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

  const view = viewState(state, nowMs);
  const nodeNames = useMemo(() => Object.keys(state.nodes).sort(), [state.nodes]);
  const filtered = useMemo(() => filterFrames(state.frames, filter, nowMs), [state.frames, filter, nowMs]);
  const selected = state.frames.find((f) => f.seq === selectedSeq) ?? null;
  const notCurrent = view === 'stale' || view === 'disconnected' || view === 'error';

  const connected = useMemo(() => {
    const open = (n: DeviceNode) => snapshot.links.some((l) => l.node === n && l.state === 'open' && !l.conflict);
    return { node1: open('node1'), node2: open('node2'), monitor: open('monitor') };
  }, [snapshot]);

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
        {physical && (
          <ConnectionPanel
            snapshot={snapshot}
            nowMs={nowMs}
            onAddPort={() => physical.addPort()}
            onOpen={(id) => void physical.openLink(id)}
            onClose={(id) => void physical.closeLink(id)}
            onForget={(id) => void physical.forgetPort(id)}
            onOpenAll={() => void physical.openAllKnown()}
          />
        )}
        <TelemetryPanel state={state} nowMs={nowMs} ecuConnected={physical ? connected : {}} />
        <FaultPanel state={state} nowMs={nowMs} />
        <ControlPanel
          send={physical ? (node, text) => physical.sendCommand(node, text) : null}
          connected={connected}
          commands={snapshot.commands}
          nowMs={nowMs}
        />
        <h2>CAN bus and controllers</h2>
        <BusSummary
          busState={overallBusState(state.nodes)}
          frameRate={view === 'live' ? frameRate(state.frames, nowMs) : 0}
          counters={totalCounters(state.nodes)}
          bufferedFrames={state.frames.length}
          droppedFromView={state.droppedFromView}
          dimmed={notCurrent}
        />
        <NodeHealthCards nodes={state.nodes} nowMs={nowMs} />
        {state.selftest && <SelftestCard selftest={state.selftest} />}
        <section className="frames-layout" aria-label="Raw CAN frames">
          <div className={`card frames-card ${notCurrent ? 'dimmed' : ''}`}>
            <h2>Live CAN traffic (captured by Node 3)</h2>
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
        CANScope never transmits raw CAN frames from the dashboard. Commands are allow-listed text lines sent to one
        node over its own USB port and count only when that node acknowledges them. Values under "Observed on CAN" come
        only from frames Node 3 received; ECU self-reports are labelled separately. Legacy test IDs stay unverified.
      </footer>
    </div>
  );
}
