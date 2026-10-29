import { useMemo, useState, useSyncExternalStore } from 'react';

import { BusSummary } from '../components/BusSummary';
import { ConnectionPanel } from '../components/ConnectionPanel';
import { ControlPanel } from '../components/ControlPanel';
import { ExampleFrames } from '../components/ExampleFrames';
import { CommandedFaults, DetectedFaults } from '../components/FaultPanel';
import { FrameDetail } from '../components/FrameDetail';
import { FrameFilters } from '../components/FrameFilters';
import { FrameTable } from '../components/FrameTable';
import { NodeHealthCards } from '../components/NodeHealthCards';
import { SelftestCard } from '../components/SelftestCard';
import { StateBanner } from '../components/StateBanner';
import { StatusBar } from '../components/StatusBar';
import { SystemStatus } from '../components/SystemStatus';
import { TabNav, TabPanel, type TabDef } from '../components/TabNav';
import { TelemetryPanel } from '../components/TelemetryPanel';
import { frameRate, isNodeStale, overallBusState, totalCounters, viewState } from '../lib/dashboard-state';
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

type TabIdName = 'overview' | 'traffic' | 'faults' | 'connections' | 'diagnostics';
const TAB_IDS: readonly TabIdName[] = ['overview', 'traffic', 'faults', 'connections', 'diagnostics'];

const NO_PHYSICAL: PhysicalSnapshot = { supported: false, unsupportedReason: null, links: [], commands: [] };
const subscribeNone = () => () => undefined;
const getNone = () => NO_PHYSICAL;
const DEVICES: DeviceNode[] = ['node1', 'node2', 'monitor'];

function tabFromHash(physical: boolean): TabIdName {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  const tab = TAB_IDS.find((t) => t === hash);
  if (!tab || (tab === 'connections' && !physical)) return 'overview';
  return tab;
}

export function DashboardPage({ source, physical, headerExtras, flushMs = 100 }: Props) {
  const { state, nowMs } = useCanScope(source, 500, flushMs);
  const snapshot = useSyncExternalStore(physical?.subscribe ?? subscribeNone, physical?.getSnapshot ?? getNone);
  const [filter, setFilter] = useState<FrameFilter>(DEFAULT_FILTER);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [tab, setTab] = useState<TabIdName>(() => tabFromHash(!!physical));

  const selectTab = (next: TabIdName) => {
    setTab(next);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.search}#${next}`);
  };

  const view = viewState(state, nowMs);
  const nodeNames = useMemo(() => Object.keys(state.nodes).sort(), [state.nodes]);
  const filtered = useMemo(
    () => (tab === 'traffic' ? filterFrames(state.frames, filter, nowMs) : []),
    [tab, state.frames, filter, nowMs],
  );
  const selected = state.frames.find((f) => f.seq === selectedSeq) ?? null;
  const notCurrent = view === 'stale' || view === 'disconnected' || view === 'error';

  const usb = useMemo(() => {
    const open = (n: DeviceNode) => snapshot.links.some((l) => l.node === n && l.state === 'open' && !l.conflict);
    return { node1: open('node1'), node2: open('node2'), monitor: open('monitor') };
  }, [snapshot]);
  const boardsConnected = DEVICES.filter((n) => usb[n]).length;

  const monitorNode = state.nodes.monitor;
  const monitorReporting = !!monitorNode && !isNodeStale(monitorNode, nowMs);
  const monitorOnline = physical ? usb.monitor && monitorReporting : monitorReporting;
  const rate = view === 'live' ? frameRate(state.frames, nowMs) : 0;
  const busState = overallBusState(state.nodes);

  const activeCount = monitorOnline ? state.activeFaults.length : null;
  const tabs: TabDef<TabIdName>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'traffic', label: 'Live CAN data', badge: rate > 0 ? { text: `${Math.round(rate)}/s`, tone: 'muted' } : null },
    {
      id: 'faults',
      label: 'Fault testing',
      badge: activeCount ? { text: `${activeCount} active`, tone: state.activeFaults.some((f) => f.severity === 'critical') ? 'bad' : 'warn' } : null,
    },
    ...(physical
      ? [
          {
            id: 'connections' as const,
            label: 'Connections',
            badge: { text: `${boardsConnected}/3`, tone: boardsConnected === 3 ? ('ok' as const) : ('warn' as const) },
          },
        ]
      : []),
    { id: 'diagnostics', label: 'Diagnostics' },
  ];

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <StatusBar
        origin={state.sourceKind}
        sourceLabel={state.sourceLabel}
        connection={state.connection}
        boardsConnected={physical ? boardsConnected : undefined}
      >
        {headerExtras}
      </StatusBar>
      <TabNav tabs={tabs} selected={tab} onSelect={selectTab} label="Dashboard sections" />
      <main id="main">
        <StateBanner
          view={view}
          origin={state.sourceKind}
          detail={state.connectionDetail}
          lastEventAgeMs={state.lastEventMs === null ? null : nowMs - state.lastEventMs}
        />

        <TabPanel id="overview" selected={tab === 'overview'}>
          <SystemStatus
            physical={!!physical}
            usb={physical ? usb : { node1: false, node2: false, monitor: false }}
            monitorOnline={monitorOnline}
            faultListReceived={state.lastSnapshotMs !== null}
            frameRate={rate}
            activeFaults={state.activeFaults}
            busState={busState}
          />
          <TelemetryPanel state={state} nowMs={nowMs} ecuConnected={physical ? usb : {}} />
          <DetectedFaults state={state} nowMs={nowMs} monitorOnline={monitorOnline} />
        </TabPanel>

        <TabPanel id="traffic" selected={tab === 'traffic'}>
          <BusSummary
            busState={busState}
            frameRate={rate}
            counters={totalCounters(state.nodes)}
            bufferedFrames={state.frames.length}
            droppedFromView={state.droppedFromView}
            dimmed={notCurrent}
          />
          <div className="frames-layout">
            <section className={`card frames-card ${notCurrent ? 'dimmed' : ''}`} aria-labelledby="frames-title">
              <div className="card-head">
                <h2 id="frames-title">Frames received by Node 3</h2>
              </div>
              <p className="card-intro" data-testid="frames-intro">
                {state.sourceKind === 'mock'
                  ? 'Mock preview: these frames are generated in the browser. They are not CAN traffic.'
                  : state.frames.length === 0
                    ? 'Frames Node 3 captures on the bus are listed here with its own validation verdict. None has been received yet.'
                    : 'Every row is a frame Node 3 captured on the bus, with its own validation verdict. Nothing here is generated by the dashboard.'}
              </p>
              <FrameFilters filter={filter} nodes={nodeNames} onChange={setFilter} />
              {state.frames.length === 0 ? (
                <>
                  <p className="muted" data-testid="frames-none">
                    {monitorOnline || !physical ? 'No frames received.' : 'No frames: Node 3 is not connected.'}
                  </p>
                  <ExampleFrames />
                </>
              ) : (
                tab === 'traffic' && <FrameTable frames={filtered} selectedSeq={selectedSeq} onSelect={setSelectedSeq} />
              )}
            </section>
            <FrameDetail frame={selected} />
          </div>
        </TabPanel>

        <TabPanel id="faults" selected={tab === 'faults'}>
          <p className="panel-intro">
            Inject a fault on an ECU below, then check here that Node 3 detects it on its own. A requested fault is never
            shown as detected.
          </p>
          <CommandedFaults state={state} monitorOnline={monitorOnline} />
          <ControlPanel
            send={physical ? (node, text) => physical.sendCommand(node, text) : null}
            connected={usb}
            commands={snapshot.commands}
            nowMs={nowMs}
          />
        </TabPanel>

        {physical && (
          <TabPanel id="connections" selected={tab === 'connections'}>
            <ConnectionPanel
              snapshot={snapshot}
              nowMs={nowMs}
              onAddPort={() => physical.addPort()}
              onOpen={(id) => void physical.openLink(id)}
              onClose={(id) => void physical.closeLink(id)}
              onForget={(id) => physical.forgetPort(id)}
              onOpenAll={() => void physical.openAllKnown()}
            />
          </TabPanel>
        )}

        <TabPanel id="diagnostics" selected={tab === 'diagnostics'}>
          <NodeHealthCards nodes={state.nodes} nowMs={nowMs} />
          {state.selftest && <SelftestCard selftest={state.selftest} />}
        </TabPanel>
      </main>
    </div>
  );
}
