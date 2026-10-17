import { useMemo, useState } from 'react';

import { PhysicalSource } from './lib/serial/physical-source';
import { MOCK_SCENARIOS, MockCanDataSource, scenarioFromUrl, type MockScenario } from './mock-data/mock-source';
import { DashboardPage } from './pages/DashboardPage';

type Mode = 'physical' | 'mock';

export function modeFromUrl(search: string): Mode {
  return new URLSearchParams(search).get('source') === 'mock' ? 'mock' : 'physical';
}

function setParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(null, '', url);
}

// Physical mode (USB serial via Web Serial) is the default. The mock preview
// is only used when chosen explicitly, and is always labelled MOCK DATA; the
// physical source never falls back to it.
export function App() {
  const [mode, setMode] = useState<Mode>(() => modeFromUrl(window.location.search));
  const [scenario, setScenario] = useState<MockScenario>(() => scenarioFromUrl(window.location.search));
  const physical = useMemo(() => (mode === 'physical' ? PhysicalSource.fromBrowser() : null), [mode]);
  const mock = useMemo(() => (mode === 'mock' ? new MockCanDataSource({ scenario }) : null), [mode, scenario]);

  const picker = (
    <div className="row">
      <label className="scenario-picker" title="Physical: real boards over USB. Mock: a labelled UI preview with no hardware.">
        Data source
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value as Mode;
            setMode(next);
            setParam('source', next === 'mock' ? 'mock' : null);
          }}
        >
          <option value="physical">Physical (USB serial)</option>
          <option value="mock">Mock preview (no hardware)</option>
        </select>
      </label>
      {mode === 'mock' && (
        <label className="scenario-picker">
          Mock scenario
          <select
            value={scenario}
            onChange={(e) => {
              const next = e.target.value as MockScenario;
              setScenario(next);
              setParam('scenario', next);
            }}
          >
            {MOCK_SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );

  if (physical) return <DashboardPage key="physical" source={physical} physical={physical} headerExtras={picker} />;
  return <DashboardPage key={`mock-${scenario}`} source={mock!} headerExtras={picker} />;
}
