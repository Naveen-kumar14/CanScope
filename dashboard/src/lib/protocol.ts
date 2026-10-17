// CANScope protocol v1 helpers for the dashboard, driven entirely by the
// generated spec (protocol-spec.generated.ts <- protocol/canscope_protocol.json).
// The same golden vectors check this code and the C++ firmware codec.

import {
  DEMO_FAULTS,
  ECU_COMMANDS,
  FAULTS,
  MESSAGES,
  NODES,
  PROTOCOL_VERSION,
  type DemoFaultName,
  type FaultCode,
  type Severity,
} from './protocol-spec.generated';

export interface ProtocolField {
  key: string;
  start: number;
  length: number;
  signed: boolean;
  factor: number;
  decimals: number;
  unit: string;
  validMin: number;
  validMax: number;
  default?: number;
}

export interface ProtocolMessage {
  name: string;
  canId: number;
  sender: string;
  kind: string;
  dlc: number;
  periodMs: number;
  counterByte: number;
  checksumByte: number;
  fields: readonly ProtocolField[];
}

/** The generated literal-typed table, widened for generic code. */
export const PROTOCOL_MESSAGES: readonly ProtocolMessage[] = MESSAGES;

export function messageById(canId: number): ProtocolMessage | null {
  return PROTOCOL_MESSAGES.find((m) => m.canId === canId) ?? null;
}

export function checksum(canId: number, data: readonly number[]): number {
  let sum = ((canId >> 8) & 0xff) + (canId & 0xff);
  for (let i = 0; i < 7; i++) sum += data[i] ?? 0;
  return ~sum & 0xff;
}

export function readField(data: readonly number[], f: ProtocolField): number {
  let v = 0;
  for (let i = 0; i < f.length; i++) v = v * 256 + (data[f.start + i] ?? 0);
  const bits = f.length * 8;
  if (f.signed && v >= 2 ** (bits - 1)) v -= 2 ** bits;
  return v;
}

export function encodeFields(msg: ProtocolMessage, raw: Record<string, number>, counter: number): number[] {
  const out = new Array<number>(msg.dlc).fill(0);
  for (const f of msg.fields) {
    let v = raw[f.key] ?? 0;
    if (v < 0) v += 2 ** (8 * f.length);
    for (let i = 0; i < f.length; i++) out[f.start + f.length - 1 - i] = Math.floor(v / 256 ** i) % 256;
  }
  out[msg.counterByte] = counter & 0xff;
  out[msg.checksumByte] = checksum(msg.canId, out);
  return out;
}

export type V1Check = 'ok' | 'bad_dlc' | 'remote_frame' | 'bad_checksum' | 'value_out_of_range' | 'bad_node_id' | 'unsupported_version';

export interface V1Decode {
  message: ProtocolMessage;
  check: V1Check;
  /** Raw integer per field key. */
  raw: Record<string, number>;
  /** Physical value per field key (raw * factor), only when check === 'ok'. */
  physical: Record<string, number> | null;
  counter: number | null;
}

/** Independent dashboard-side validation of a protocol v1 frame (same rules as Node 3). */
export function decodeV1(frame: {
  canId: number;
  identifierFormat: 'standard' | 'extended';
  remote: boolean;
  dlc: number;
  data: readonly number[];
}): V1Decode | null {
  if (frame.identifierFormat !== 'standard') return null;
  const message = messageById(frame.canId);
  if (!message) return null;
  const base = { message, raw: {}, physical: null, counter: null };
  if (frame.remote) return { ...base, check: 'remote_frame' };
  if (frame.dlc !== message.dlc || frame.data.length !== message.dlc) return { ...base, check: 'bad_dlc' };
  if (checksum(frame.canId, frame.data) !== frame.data[message.checksumByte]) return { ...base, check: 'bad_checksum' };
  const raw: Record<string, number> = {};
  const outOfRange = (f: ProtocolField) => raw[f.key] < f.validMin || raw[f.key] > f.validMax;
  for (const f of message.fields) raw[f.key] = readField(frame.data, f);
  let check: V1Check = 'ok';
  if (message.kind === 'heartbeat') {
    // Same order as firmware proto::decode(): node id, version, then ranges.
    const nodeField = message.fields.find((f) => f.key === 'nodeId');
    if (nodeField && outOfRange(nodeField)) check = 'bad_node_id';
    else if (raw.protocolVersion !== PROTOCOL_VERSION) check = 'unsupported_version';
    else if (message.fields.some(outOfRange)) check = 'value_out_of_range';
  } else if (message.fields.some(outOfRange)) {
    check = 'value_out_of_range';
  }
  const physical: Record<string, number> | null = check === 'ok' ? {} : null;
  if (physical) {
    for (const f of message.fields) physical[f.key] = roundTo(raw[f.key] * f.factor, f.decimals);
  }
  return { message, check, raw, physical, counter: frame.data[message.counterByte] };
}

export function roundTo(value: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

// ------------------------------------------------------------ fields / units

export const TELEMETRY_FIELDS: readonly ProtocolField[] = PROTOCOL_MESSAGES.filter((m) => m.kind === 'telemetry').flatMap(
  (m) => [...m.fields],
);

export function fieldByKey(key: string): ProtocolField | null {
  return TELEMETRY_FIELDS.find((f) => f.key === key) ?? null;
}

export function unitLabel(unit: string): string {
  return unit === 'degC' ? '°C' : unit;
}

export function formatPhysical(key: string, value: number | undefined | null): string {
  const f = fieldByKey(key);
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return f ? value.toFixed(f.decimals) : String(value);
}

export function physicalRange(f: ProtocolField): { min: number; max: number; step: number } {
  return {
    min: roundTo(f.validMin * f.factor, f.decimals),
    max: roundTo(f.validMax * f.factor, f.decimals),
    step: 10 ** -f.decimals,
  };
}

// ------------------------------------------------------------------ commands

export interface CommandParam {
  node: 'node1' | 'node2';
  param: string;
  field: ProtocolField;
}

export const COMMAND_PARAMS: readonly CommandParam[] = (Object.keys(ECU_COMMANDS) as ('node1' | 'node2')[]).flatMap(
  (node) =>
    ECU_COMMANDS[node].map((c) => ({ node, param: c.param, field: fieldByKey(c.field) as ProtocolField })),
);

export type ValueCheck = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Mirrors the firmware's exact decimal parser (proto::parse_scaled) so a value
 * the dashboard accepts is one the ECU accepts: optional sign, digits, at most
 * `decimals` fractional digits, inside the valid range. No exponents or hex.
 */
export function validateCommandValue(param: CommandParam, input: string): ValueCheck {
  const text = input.trim();
  const f = param.field;
  if (text === '') return { ok: false, reason: 'enter a value' };
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return { ok: false, reason: 'not a decimal number' };
  const frac = m[3] ?? '';
  if (frac.length > f.decimals) return { ok: false, reason: `at most ${f.decimals} decimal places` };
  const raw = Number(`${m[1]}${m[2]}${frac.padEnd(f.decimals, '0')}`);
  if (!Number.isSafeInteger(raw) || raw < f.validMin || raw > f.validMax) {
    const r = physicalRange(f);
    return {
      ok: false,
      reason: `out of range ${r.min.toFixed(f.decimals)}..${r.max.toFixed(f.decimals)} ${unitLabel(f.unit)}`,
    };
  }
  return { ok: true, text };
}

// -------------------------------------------------------------------- faults

export function faultInfo(code: string) {
  return FAULTS.find((f) => f.code === code) ?? null;
}

export function faultSeverity(code: string): Severity {
  return (faultInfo(code)?.severity as Severity | undefined) ?? 'warning';
}

export function demoFault(name: string) {
  return DEMO_FAULTS.find((d) => d.name === name) ?? null;
}

export function expectedDetections(name: DemoFaultName | string): readonly FaultCode[] {
  return (demoFault(name)?.expected as readonly FaultCode[] | undefined) ?? [];
}

export function nodeLabel(name: string): string {
  return NODES.find((n) => n.name === name)?.label ?? name;
}
