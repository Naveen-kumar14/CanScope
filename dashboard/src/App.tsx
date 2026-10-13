import { useMemo, useState } from 'react';

import { MOCK_SCENARIOS, MockCanDataSource, scenarioFromUrl, type MockScenario } from './mock-data/mock-source';
import { DashboardPage } from './pages/DashboardPage';

// Only the mock source exists today. A live adapter (serial bridge/WebSocket)
// implementing CanDataSource can be selected here later without UI changes.
export function App() {
  const [scenario, setScenario] = useState<MockScenario>(() => scenarioFromUrl(window.location.search));
  const source = useMemo(() => new MockCanDataSource({ scenario }), [scenario]);

  const picker = (
    <label className="scenario-picker" title="Simulation scenario (local only, sends nothing)">
      Mock scenario
      <select
        value={scenario}
        onChange={(e) => {
          const next = e.target.value as MockScenario;
          setScenario(next);
          const url = new URL(window.location.href);
          url.searchParams.set('scenario', next);
          window.history.replaceState(null, '', url);
        }}
      >
        {MOCK_SCENARIOS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );

  return <DashboardPage source={source} headerExtras={picker} />;
}
