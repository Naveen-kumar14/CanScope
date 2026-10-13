// Dashboard copy of the CAN ID registry. The authoritative, human-readable
// registry is docs/protocol/can-id-registry.md; firmware/common/protocol_decoder
// holds the C++ copy. Keep all three in step.
//
// NO production IDs exist yet. Only IDs observed in the existing
// sketch_node2_test.ino test sketch are listed, all UNVERIFIED.

import type { IdentifierFormat } from '../types/events';

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

export const PRODUCTION_REGISTRY: readonly RegistryEntry[] = [];

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
