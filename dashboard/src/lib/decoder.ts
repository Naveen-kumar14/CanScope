// Decoder: classifies a frame against the registry. Never drops or alters the
// raw frame; physical values appear only for VERIFIED entries with known scaling.

import type { CanFrameEvent } from '../types/events';
import { ACTIVE_REGISTRY, type FieldDef, type RegistryEntry } from './protocol-registry';

export type DecodeStatus = 'decoded' | 'unverified' | 'unknown' | 'mismatch';

export interface DecodedField {
  name: string;
  raw: number;
  physical: number | null;
  unit: string | null;
}

export interface DecodeResult {
  status: DecodeStatus;
  entry: RegistryEntry | null;
  fields: DecodedField[];
  reason?: string;
}

type FrameLike = Pick<CanFrameEvent, 'canId' | 'identifierFormat' | 'remote' | 'dlc' | 'data'>;

export function parseCanId(canId: string): number {
  return Number.parseInt(canId, 16);
}

export function findEntry(
  frame: Pick<FrameLike, 'canId' | 'identifierFormat'>,
  registry: readonly RegistryEntry[] = ACTIVE_REGISTRY,
): RegistryEntry | null {
  const id = parseCanId(frame.canId);
  return registry.find((e) => e.canId === id && e.identifierFormat === frame.identifierFormat) ?? null;
}

export function extractRaw(data: readonly number[], field: FieldDef): number | null {
  const { startByte, lengthBytes, byteOrder, signed } = field;
  if (startByte + lengthBytes > data.length) return null;
  if (byteOrder === 'unverified' && lengthBytes > 1) return null;
  let value = 0;
  for (let i = 0; i < lengthBytes; i++) {
    const index = byteOrder === 'little_endian' ? startByte + lengthBytes - 1 - i : startByte + i;
    value = value * 256 + data[index];
  }
  const bits = lengthBytes * 8;
  if (signed && value >= 2 ** (bits - 1)) value -= 2 ** bits;
  return value;
}

export function decodeFrame(
  frame: FrameLike,
  registry: readonly RegistryEntry[] = ACTIVE_REGISTRY,
): DecodeResult {
  const entry = findEntry(frame, registry);
  if (!entry) return { status: 'unknown', entry: null, fields: [] };
  if (frame.remote) return { status: 'mismatch', entry, fields: [], reason: 'remote frame' };
  if (frame.dlc !== entry.dlc) {
    return { status: 'mismatch', entry, fields: [], reason: `DLC ${frame.dlc}, registry ${entry.dlc}` };
  }
  const verified = entry.status === 'verified';
  const fields: DecodedField[] = [];
  for (const f of entry.fields) {
    const raw = extractRaw(frame.data, f);
    if (raw === null) return { status: 'mismatch', entry, fields: [], reason: `field ${f.name} out of range` };
    const usePhysical = verified && f.scaling !== null;
    fields.push({
      name: f.name,
      raw,
      physical: usePhysical && f.scaling ? Math.round((raw * f.scaling.factor + f.scaling.offset) * 1e6) / 1e6 : null,
      unit: usePhysical && f.scaling ? f.scaling.unit : null,
    });
  }
  return { status: verified ? 'decoded' : 'unverified', entry, fields };
}

export function isVerifiedFrame(frame: FrameLike, registry?: readonly RegistryEntry[]): boolean {
  return decodeFrame(frame, registry).status === 'decoded';
}
