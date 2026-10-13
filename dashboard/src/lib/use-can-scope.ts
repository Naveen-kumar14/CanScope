import { useEffect, useReducer, useState } from 'react';

import type { CanDataSource } from './data-source';
import { initialState, reducer } from './dashboard-state';

/** Connects a data source to the dashboard reducer and keeps a ticking clock for staleness. */
export function useCanScope(source: CanDataSource, clockMs = 500) {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    initialState(source.kind, source.label),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    dispatch({ type: 'reset', sourceKind: source.kind, sourceLabel: source.label });
    source.connect({
      onEvent: (event) => dispatch({ type: 'event', event, receivedAtMs: Date.now() }),
      onConnectionChange: (s, detail) => dispatch({ type: 'connection', state: s, detail }),
    });
    return () => source.disconnect();
  }, [source]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), clockMs);
    return () => clearInterval(id);
  }, [clockMs]);

  return { state, nowMs };
}
