// Parses one firmware serial line into a dashboard event.
//
// Firmware emits JSON event lines starting with '{' and human-readable
// diagnostic lines starting with "# ". Anything else, any JSON that does not
// match a known event shape, and any field with the wrong type is reported as
// 'invalid' and never turned into data. Optional numeric fields that are
// missing stay undefined/null; they are never defaulted to plausible values.
//
// The host supplies the receive time because the ESP32 has no wall clock.

import type {
  AckEvent,
  ActiveFault,
  BusState,
  CanScopeEvent,
  DataOrigin,
  DeviceNode,
  EcuNode,
  FaultSeverity,
  IdentifierFormat,
  LinkState,
  TransceiverCheck,
  ValueStatus,
} from '../types/events';
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
const LINK_STATES: readonly LinkState[] = ['unknown', 'waiting', 'ok', 'lost'];
const SEVERITIES: readonly FaultSeverity[] = ['info', 'warning', 'critical'];
const DEVICE_NODES: readonly DeviceNode[] = ['node1', 'node2', 'monitor'];
const ECU_NODES: readonly EcuNode[] = ['node1', 'node2'];
const ID_FORMATS: readonly IdentifierFormat[] = ['standard', 'extended'];
const TRANSCEIVER_CHECKS: readonly TransceiverCheck[] = [
  'not_run',
  'ok',
  'rx_not_driven',
  'rx_stuck_dominant',
  'no_echo',
  'inconsistent',
];
const STATUS_COUNTERS = [
  'txErrorCount',
  'rxErrorCount',
  'rxFrames',
  'txFrames',
  'txFailed',
  'rxMissed',
  'busErrors',
  'arbitrationLost',
  'busOffEvents',
] as const;
const MAX_CLASSICAL_PAYLOAD = 8;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const str = (v: unknown): v is string => typeof v === 'string';
const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : num(v));
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

function busState(v: unknown): BusState {
  return BUS_STATES.includes(v as BusState) ? (v as BusState) : 'unknown';
}

function numberRecord(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) {
    const n = num(x);
    if (n === undefined) return null;
    out[k] = n;
  }
  return out;
}

class Invalid extends Error {}
function need(cond: boolean, reason: string): asserts cond {
  if (!cond) throw new Invalid(reason);
}

export function parseSerialLine(
  line: string,
  receivedAt: Date,
  origin: DataOrigin = 'live',
  link?: string,
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

  const base = {
    timestamp: receivedAt.toISOString(),
    deviceTimeUs: num(raw.deviceTimeUs),
    sourceNode: typeof raw.sourceNode === 'string' ? raw.sourceNode : 'unknown',
    origin,
    ...(link !== undefined ? { link } : {}),
  };

  try {
    const event = parseEvent(raw, base);
    if (event === null) return { kind: 'invalid', reason: 'unknown event type', line };
    return { kind: 'event', event };
  } catch (e) {
    if (e instanceof Invalid) return { kind: 'invalid', reason: e.message, line };
    throw e;
  }
}

type Base = {
  timestamp: string;
  deviceTimeUs: number | undefined;
  sourceNode: string;
  origin: DataOrigin;
  link?: string;
};

function parseEvent(raw: Record<string, unknown>, base: Base): CanScopeEvent | null {
  switch (raw.type) {
    case 'frame': {
      // Classical CAN only (the ESP32 TWAI controller cannot do CAN FD). The
      // firmware always sends identifierFormat, remote, dlc and data, so a
      // missing or mistyped field is an invalid line, never a guessed value.
      need(oneOf(ID_FORMATS, raw.identifierFormat), 'frame: bad identifierFormat');
      const format: IdentifierFormat = raw.identifierFormat;
      need(typeof raw.remote === 'boolean', 'frame: bad remote flag');
      const canId = typeof raw.canId === 'string' ? raw.canId : '';
      // 8 hex digits are enough for any 29-bit id and keep parseInt exact.
      need(/^0x[0-9a-fA-F]{1,8}$/.test(canId), 'frame: bad canId');
      const idValue = Number.parseInt(canId, 16);
      need(idValue <= (format === 'extended' ? 0x1fffffff : 0x7ff), 'frame: canId out of range for its format');
      const dlc = raw.dlc;
      // DLC 9..15 is legal on a classical bus and still means 8 data bytes.
      need(nonNegInt(dlc) && dlc <= 15, 'frame: bad dlc');
      need(Array.isArray(raw.data) && raw.data.every((b) => Number.isInteger(b) && b >= 0 && b <= 255), 'frame: bad data');
      const data = raw.data as number[];
      const expectedBytes = raw.remote ? 0 : Math.min(dlc, MAX_CLASSICAL_PAYLOAD);
      need(data.length === expectedBytes, `frame: ${data.length} data bytes do not match ${raw.remote ? 'a remote frame' : `DLC ${dlc}`}`);
      need(raw.txErrorCount === undefined || nonNegInt(raw.txErrorCount), 'frame: bad txErrorCount');
      need(raw.rxErrorCount === undefined || nonNegInt(raw.rxErrorCount), 'frame: bad rxErrorCount');
      const event = {
        type: 'frame' as const,
        ...base,
        canId:
          format === 'extended'
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
        ...(str(raw.kind) ? { kind: raw.kind } : {}),
        ...(str(raw.check) ? { check: raw.check } : {}),
        ...(typeof raw.accepted === 'boolean' ? { accepted: raw.accepted } : {}),
      };
      event.verified = isVerifiedFrame(event);
      return event;
    }

    case 'status': {
      // Every field is required: a missing counter must never read as a
      // genuine zero. Only transceiverCheck is optional (older firmware).
      need(oneOf(BUS_STATES, raw.busState), 'status: bad busState');
      need(typeof raw.driverRunning === 'boolean' && typeof raw.txEnabled === 'boolean', 'status: bad flags');
      need(str(raw.mode) && raw.mode !== '', 'status: bad mode');
      need(nonNegInt(raw.bitrate), 'status: bad bitrate');
      need(oneOf(VALUE_STATUSES, raw.configStatus), 'status: bad configStatus');
      for (const c of STATUS_COUNTERS) need(nonNegInt(raw[c]), `status: missing or invalid ${c}`);
      need(
        raw.transceiverCheck === undefined || oneOf(TRANSCEIVER_CHECKS, raw.transceiverCheck),
        'status: bad transceiverCheck',
      );
      const counter = (c: (typeof STATUS_COUNTERS)[number]) => raw[c] as number;
      return {
        type: 'status',
        ...base,
        busState: raw.busState,
        driverRunning: raw.driverRunning as boolean,
        mode: raw.mode,
        txEnabled: raw.txEnabled as boolean,
        bitrate: raw.bitrate,
        configStatus: raw.configStatus,
        txErrorCount: counter('txErrorCount'),
        rxErrorCount: counter('rxErrorCount'),
        rxFrames: counter('rxFrames'),
        txFrames: counter('txFrames'),
        txFailed: counter('txFailed'),
        rxMissed: counter('rxMissed'),
        busErrors: counter('busErrors'),
        arbitrationLost: counter('arbitrationLost'),
        busOffEvents: counter('busOffEvents'),
        transceiverCheck: raw.transceiverCheck === undefined ? null : raw.transceiverCheck,
      };
    }

    case 'hello': {
      need(oneOf(DEVICE_NODES, raw.sourceNode), 'hello: unknown sourceNode');
      need(nonNegInt(raw.nodeId) && str(raw.role) && str(raw.firmware), 'hello: bad identity');
      need(str(raw.bootId) && /^[0-9a-f]{8}$/.test(raw.bootId), 'hello: bad bootId');
      need(nonNegInt(raw.protocolVersion) && nonNegInt(raw.serialProtocolVersion), 'hello: bad version');
      return {
        type: 'hello',
        ...base,
        nodeId: raw.nodeId,
        role: raw.role,
        firmware: raw.firmware,
        bootId: raw.bootId,
        protocolVersion: raw.protocolVersion,
        serialProtocolVersion: raw.serialProtocolVersion,
        commands: str(raw.commands) ? raw.commands.split(' ').filter(Boolean) : [],
      };
    }

    case 'ack': {
      need(str(raw.id) && str(raw.command) && str(raw.detail) && str(raw.bootId), 'ack: missing field');
      need(raw.status === 'ok' || raw.status === 'rejected' || raw.status === 'unsupported', 'ack: bad status');
      return {
        type: 'ack',
        ...base,
        bootId: raw.bootId,
        id: raw.id,
        command: raw.command,
        status: raw.status as AckEvent['status'],
        detail: raw.detail,
      };
    }

    case 'telemetry': {
      need(oneOf(ECU_NODES, raw.node), 'telemetry: bad node');
      need(typeof raw.valid === 'boolean' && oneOf(LINK_STATES, raw.state), 'telemetry: bad state');
      const ageMs = numOrNull(raw.ageMs);
      need(ageMs !== undefined && nonNegInt(raw.counter), 'telemetry: bad age/counter');
      const values = numberRecord(raw.values);
      need(values !== null, 'telemetry: bad values');
      return {
        type: 'telemetry',
        ...base,
        node: raw.node,
        valid: raw.valid,
        ageMs,
        counter: raw.counter,
        state: raw.state,
        values,
      };
    }

    case 'node_health': {
      need(oneOf(ECU_NODES, raw.node), 'node_health: bad node');
      need(oneOf(LINK_STATES, raw.heartbeat) && oneOf(LINK_STATES, raw.telemetry), 'node_health: bad state');
      const hbAge = numOrNull(raw.heartbeatAgeMs);
      const telAge = numOrNull(raw.telemetryAgeMs);
      const version = numOrNull(raw.protocolVersion);
      need(hbAge !== undefined && telAge !== undefined && version !== undefined, 'node_health: bad numbers');
      const stats = numberRecord(raw.stats);
      need(stats !== null, 'node_health: bad stats');
      return {
        type: 'node_health',
        ...base,
        node: raw.node,
        heartbeat: raw.heartbeat,
        telemetry: raw.telemetry,
        heartbeatAgeMs: hbAge,
        telemetryAgeMs: telAge,
        protocolVersion: version,
        versionOk: raw.versionOk !== false,
        firmware: str(raw.firmware) ? raw.firmware : null,
        ecuCanState: str(raw.ecuCanState) ? raw.ecuCanState : null,
        stats,
      };
    }

    case 'fault': {
      need(str(raw.bootId) && nonNegInt(raw.eventId), 'fault: bad id');
      need(str(raw.code) && /^[A-Z_]+$/.test(raw.code), 'fault: bad code');
      need(oneOf(DEVICE_NODES, raw.node) && oneOf(SEVERITIES, raw.severity), 'fault: bad node/severity');
      need(raw.state === 'active' || raw.state === 'cleared', 'fault: bad state');
      return {
        type: 'fault',
        ...base,
        bootId: raw.bootId,
        eventId: raw.eventId,
        code: raw.code,
        node: raw.node,
        severity: raw.severity,
        state: raw.state,
        detail: str(raw.detail) ? raw.detail : '',
      };
    }

    case 'faults': {
      need(str(raw.bootId) && nonNegInt(raw.lastEventId) && nonNegInt(raw.count), 'faults: bad header');
      need(Array.isArray(raw.active), 'faults: bad list');
      const active: ActiveFault[] = [];
      for (const a of raw.active) {
        need(isObj(a) && str(a.code) && oneOf(DEVICE_NODES, a.node) && oneOf(SEVERITIES, a.severity), 'faults: bad entry');
        need(nonNegInt(a.ageMs), 'faults: bad age');
        active.push({ code: a.code, node: a.node, severity: a.severity, ageMs: a.ageMs, detail: str(a.detail) ? a.detail : '' });
      }
      return {
        type: 'faults',
        ...base,
        bootId: raw.bootId,
        lastEventId: raw.lastEventId,
        count: raw.count,
        active,
        truncated: raw.truncated === true,
      };
    }

    case 'ecu_state': {
      need(oneOf(ECU_NODES, raw.sourceNode), 'ecu_state: bad sourceNode');
      need(str(raw.bootId) && str(raw.role) && str(raw.profile) && str(raw.demoFault), 'ecu_state: missing field');
      const setpoint = numberRecord(raw.setpoint);
      const sent = numberRecord(raw.sent);
      need(setpoint !== null && sent !== null, 'ecu_state: bad values');
      const counters = ['telemetryFrames', 'heartbeatFrames', 'txOk', 'txFailed', 'rxIgnored'] as const;
      for (const c of counters) need(nonNegInt(raw[c]), `ecu_state: bad ${c}`);
      return {
        type: 'ecu_state',
        ...base,
        bootId: raw.bootId,
        role: raw.role,
        canRunning: raw.canRunning === true,
        busState: str(raw.busState) ? raw.busState : 'unknown',
        profile: raw.profile,
        demoFault: raw.demoFault,
        setpoint,
        sent,
        telemetryFrames: raw.telemetryFrames as number,
        heartbeatFrames: raw.heartbeatFrames as number,
        txOk: raw.txOk as number,
        txFailed: raw.txFailed as number,
        rxIgnored: raw.rxIgnored as number,
      };
    }

    case 'selftest': {
      const fields = ['bootId', 'can', 'oled', 'buttonA', 'buttonB', 'buzzer', 'leds'] as const;
      for (const f of fields) need(str(raw[f]), `selftest: missing ${f}`);
      return {
        type: 'selftest',
        ...base,
        bootId: raw.bootId as string,
        can: raw.can as string,
        oled: raw.oled as string,
        buttonA: raw.buttonA as string,
        buttonB: raw.buttonB as string,
        buzzer: raw.buzzer as string,
        leds: raw.leds as string,
      };
    }
  }
  return null;
}
