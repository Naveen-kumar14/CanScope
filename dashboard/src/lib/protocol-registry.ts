// Dashboard CAN ID registry used by the raw frame table and frame detail.
//
// - CANScope protocol v1 entries are generated from the single protocol
//   source (protocol/canscope_protocol.json via protocol-spec.generated.ts).
//   They are 'verified' in the registry sense "backed by a named
//   specification" - the project's own v1 spec - so physical values are shown.
//   That is NOT a claim that the traffic has been captured on the bench.
// - IDs observed in the legacy sketch_node2_test.ino stay UNVERIFIED.
// Human-readable registry: docs/protocol/can-id-registry.md.

import type { IdentifierFormat } from '../types/events';
import { MESSAGES, PROTOCOL_EVIDENCE } from './protocol-spec.generated';

export type ByteOrder = 'big_endian' | 'little_endian' | 'unverified';

export interface FieldDef {
  name: string;
  startByte: number;
  lengthBytes: 1 | 2 | 3 | 4;
  signed: boolean;
  byteOrder: ByteOrder;
  /** null => scaling unknown, only the raw integer may be shown. */
  scaling: { factor: number; offset: number; unit: string } | null;
}

export interface RegistryEntry {
  canId: number;
  identifierFormat: IdentifierFormat;
  name: string;
  sender: string;
  receivers: string;
  periodMs: number | null;
  trigger: string;
  dlc: number;
  fields: FieldDef[];
  counterChecksum: string;
  evidence: string;
  status: 'unverified' | 'verified';
}

export const PRODUCTION_REGISTRY: readonly RegistryEntry[] = MESSAGES.map((m) => ({
  canId: m.canId,
  identifierFormat: 'standard' as const,
  name: `${m.name} (protocol v1)`,
  sender: m.sender,
  receivers: 'monitor',
  periodMs: m.periodMs,
  trigger: 'periodic',
  dlc: m.dlc,
  fields: [
    ...m.fields.map((f) => ({
      name: f.key,
      startByte: f.start,
      lengthBytes: f.length as 1 | 2,
      signed: f.signed,
      byteOrder: 'big_endian' as const,
      scaling: { factor: f.factor, offset: 0, unit: f.unit === 'degC' ? '°C' : f.unit },
    })),
    { name: 'counter', startByte: m.counterByte, lengthBytes: 1 as const, signed: false, byteOrder: 'big_endian' as const, scaling: { factor: 1, offset: 0, unit: '' } },
    { name: 'checksum', startByte: m.checksumByte, lengthBytes: 1 as const, signed: false, byteOrder: 'big_endian' as const, scaling: { factor: 1, offset: 0, unit: '' } },
  ],
  counterChecksum: `byte ${m.counterByte} rolling counter, byte ${m.checksumByte} checksum`,
  evidence: PROTOCOL_EVIDENCE,
  status: 'verified' as const,
}));

const LEGACY_EVIDENCE =
  'sketch_node2_test.ino source only (test sketch, constant values, never captured)';

const legacy = (
  canId: number,
  name: string,
  dlc: number,
  periodMs: number,
  field: Omit<FieldDef, 'startByte' | 'byteOrder' | 'scaling'>,
): RegistryEntry => ({
  canId,
  identifierFormat: 'standard',
  name,
  sender: 'node2 (test sketch)',
  receivers: 'unspecified',
  periodMs,
  trigger: 'periodic',
  dlc,
  fields: [{ ...field, startByte: 0, byteOrder: 'big_endian', scaling: null }],
  counterChecksum: 'none observed',
  evidence: LEGACY_EVIDENCE,
  status: 'unverified',
});

export const LEGACY_TEST_SKETCH_REGISTRY: readonly RegistryEntry[] = [
  legacy(0x201, 'node2 test voltage (units unknown)', 2, 1000, { name: 'voltage_raw', lengthBytes: 2, signed: false }),
  legacy(0x202, 'node2 test current (units unknown)', 2, 1000, { name: 'current_raw', lengthBytes: 2, signed: true }),
  legacy(0x203, 'node2 test SOC (units unknown)', 1, 1000, { name: 'soc_raw', lengthBytes: 1, signed: false }),
  legacy(0x210, 'node2 test heartbeat', 1, 500, { name: 'heartbeat_raw', lengthBytes: 1, signed: false }),
];

export const ACTIVE_REGISTRY: readonly RegistryEntry[] = [
  ...PRODUCTION_REGISTRY,
  ...LEGACY_TEST_SKETCH_REGISTRY,
];
