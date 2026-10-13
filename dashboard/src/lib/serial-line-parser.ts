// Parses one firmware serial line into a dashboard event.
//
// Firmware emits: JSON event lines starting with '{' ("type":"frame"|"status")
// and human-readable diagnostic lines starting with "# ". Anything else is
// reported as 'invalid' and never silently turned into data.
//
// Used by future live adapters (serial bridge, WebSocket relay). The host
// supplies the receive time because the ESP32 has no wall clock.

import type { BusState, CanScopeEvent, DataOrigin, IdentifierFormat, ValueStatus } from '../types/events';
import { isVerifiedFrame } from './decoder';

export type ParsedLine =
  | { kind: 'event'; event: CanScopeEvent }
  | { kind: 'diagnostic'; text: string }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string; line: string };

const BUS_STATES: readonly BusState[] = [
  'unknown',
  'stopped',
  'error_active',
  'error_warning',
  'error_passive',
  'bus_off',
  'recovering',
];
const VALUE_STATUSES: readonly ValueStatus[] = ['UNVERIFIED', 'WORKING_ASSUMPTION', 'VERIFIED'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function busState(v: unknown): BusState {
  return BUS_STATES.includes(v as BusState) ? (v as BusState) : 'unknown';
}

export function parseSerialLine(
  line: string,
  receivedAt: Date,
  origin: DataOrigin = 'live',
): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (trimmed.startsWith('#')) return { kind: 'diagnostic', text: trimmed.replace(/^#\s?/, '') };
  if (!trimmed.startsWith('{')) return { kind: 'invalid', reason: 'not a JSON event line', line };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { kind: 'invalid', reason: 'malformed JSON', line };
  }
  if (!isObj(raw)) return { kind: 'invalid', reason: 'not an object', line };

  const timestamp = receivedAt.toISOString();
  const sourceNode = typeof raw.sourceNode === 'string' ? raw.sourceNode : 'unknown';

  if (raw.type === 'frame') {
    const format: IdentifierFormat = raw.identifierFormat === 'extended' ? 'extended' : 'standard';
    const canId = typeof raw.canId === 'string' ? raw.canId : '';
    const idValue = Number.parseInt(canId, 16);
    const maxId = format === 'extended' ? 0x1fffffff : 0x7ff;
    const dlc = num(raw.dlc);
    const data = Array.isArray(raw.data) ? raw.data : null;
    if (!/^0x[0-9a-fA-F]+$/.test(canId) || Number.isNaN(idValue) || idValue > maxId) {
      return { kind: 'invalid', reason: 'bad canId', line };
    }
    if (dlc === undefined || dlc < 0 || dlc > 15) return { kind: 'invalid', reason: 'bad dlc', line };
    if (!data || data.length > 8 || !data.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      return { kind: 'invalid', reason: 'bad data', line };
    }
    const event = {
      type: 'frame' as const,
      timestamp,
      deviceTimeUs: num(raw.deviceTimeUs),
      sourceNode,
      canId: format === 'extended'
        ? `0x${idValue.toString(16).toUpperCase().padStart(8, '0')}`
        : `0x${idValue.toString(16).toUpperCase().padStart(3, '0')}`,
      identifierFormat: format,
      remote: raw.remote === true,
      dlc,
      data: data as number[],
      busState: busState(raw.busState),
      txErrorCount: num(raw.txErrorCount),
      rxErrorCount: num(raw.rxErrorCount),
      verified: false,
      origin,
    };
    event.verified = isVerifiedFrame(event);
    return { kind: 'event', event };
  }

  if (raw.type === 'status') {
    const configStatus = VALUE_STATUSES.includes(raw.configStatus as ValueStatus)
      ? (raw.configStatus as ValueStatus)
      : 'UNVERIFIED';
    return {
      kind: 'event',
      event: {
        type: 'status',
        timestamp,
        deviceTimeUs: num(raw.deviceTimeUs),
        sourceNode,
        busState: busState(raw.busState),
        driverRunning: raw.driverRunning === true,
        mode: typeof raw.mode === 'string' ? raw.mode : 'unknown',
        txEnabled: raw.txEnabled === true,
        bitrate: num(raw.bitrate) ?? 0,
        configStatus,
        txErrorCount: num(raw.txErrorCount) ?? 0,
        rxErrorCount: num(raw.rxErrorCount) ?? 0,
        rxFrames: num(raw.rxFrames) ?? 0,
        txFrames: num(raw.txFrames) ?? 0,
        txFailed: num(raw.txFailed) ?? 0,
        rxMissed: num(raw.rxMissed) ?? 0,
        busErrors: num(raw.busErrors) ?? 0,
        arbitrationLost: num(raw.arbitrationLost) ?? 0,
        busOffEvents: num(raw.busOffEvents) ?? 0,
        origin,
      },
    };
  }

  return { kind: 'invalid', reason: 'unknown event type', line };
}
