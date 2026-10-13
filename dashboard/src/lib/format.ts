import type { BusState } from '../types/events';

export const hexByte = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

export const formatPayload = (data: readonly number[]) =>
  data.length === 0 ? '—' : data.map(hexByte).join(' ');

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatAge(ms: number): string {
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)} s ago`;
  return `${Math.floor(ms / 60_000)} min ago`;
}

export const BUS_STATE_LABEL: Record<BusState, string> = {
  unknown: 'Unknown',
  stopped: 'Stopped',
  error_active: 'Error active (normal)',
  error_warning: 'Error warning',
  error_passive: 'Error passive',
  bus_off: 'BUS-OFF',
  recovering: 'Recovering',
};

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export const BUS_STATE_TONE: Record<BusState, Tone> = {
  unknown: 'muted',
  stopped: 'muted',
  error_active: 'ok',
  error_warning: 'warn',
  error_passive: 'warn',
  bus_off: 'bad',
  recovering: 'warn',
};
