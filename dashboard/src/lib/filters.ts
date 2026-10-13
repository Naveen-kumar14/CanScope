import type { StoredFrame } from '../types/events';

export type TimeRange = 'all' | '10s' | '1m' | '5m';

export const TIME_RANGES: Record<TimeRange, { label: string; ms: number | null }> = {
  all: { label: 'All buffered', ms: null },
  '10s': { label: 'Last 10 s', ms: 10_000 },
  '1m': { label: 'Last 1 min', ms: 60_000 },
  '5m': { label: 'Last 5 min', ms: 300_000 },
};

export interface FrameFilter {
  canId: string; // free text: "201", "0x201", "7a"
  node: string; // 'all' or node name
  timeRange: TimeRange;
}

export const DEFAULT_FILTER: FrameFilter = { canId: '', node: 'all', timeRange: 'all' };

export function normaliseIdQuery(query: string): string {
  return query.trim().toUpperCase().replace(/^0X/, '');
}

export function filterFrames(
  frames: readonly StoredFrame[],
  filter: FrameFilter,
  nowMs: number,
): StoredFrame[] {
  const idQuery = normaliseIdQuery(filter.canId);
  const windowMs = TIME_RANGES[filter.timeRange].ms;
  return frames.filter((f) => {
    if (filter.node !== 'all' && f.sourceNode !== filter.node) return false;
    if (windowMs !== null && nowMs - f.receivedAtMs > windowMs) return false;
    if (idQuery && !f.canId.toUpperCase().replace(/^0X/, '').includes(idQuery)) return false;
    return true;
  });
}
