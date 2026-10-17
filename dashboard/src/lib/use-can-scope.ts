import { useEffect, useReducer, useState } from 'react';

import type { CanDataSource } from './data-source';
import { initialState, reducer } from './dashboard-state';
import type { CanScopeEvent } from '../types/events';

/**
 * Connects a data source to the dashboard reducer and keeps a ticking clock
 * for staleness. Events are batched every `flushMs` so a burst of serial
 * lines causes one render, not one per line (`flushMs = 0`: dispatch at once).
 */
export function useCanScope(source: CanDataSource, clockMs = 500, flushMs = 100) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(source.kind, source.label));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let queue: { event: CanScopeEvent; receivedAtMs: number }[] = [];
    const flush = () => {
      if (queue.length === 0) return;
      const items = queue;
      queue = [];
      dispatch({ type: 'events', items });
    };
    const timer = flushMs > 0 ? setInterval(flush, flushMs) : null;
    dispatch({ type: 'reset', sourceKind: source.kind, sourceLabel: source.label });
    source.connect({
      onEvent: (event) => {
        if (flushMs > 0) queue.push({ event, receivedAtMs: Date.now() });
        else dispatch({ type: 'event', event, receivedAtMs: Date.now() });
      },
      onConnectionChange: (s, detail) => {
        flush();
        dispatch({ type: 'connection', state: s, detail });
      },
    });
    return () => {
      if (timer !== null) clearInterval(timer);
      source.disconnect();
    };
  }, [source, flushMs]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), clockMs);
    return () => clearInterval(id);
  }, [clockMs]);

  return { state, nowMs };
}
