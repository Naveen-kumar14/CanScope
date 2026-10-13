import { describe, expect, it } from 'vitest';

import { decodeFrame, extractRaw, isVerifiedFrame } from '../src/lib/decoder';
import { LEGACY_TEST_SKETCH_REGISTRY, PRODUCTION_REGISTRY, type RegistryEntry } from '../src/lib/protocol-registry';

// EXAMPLE registry: mock data for decoder tests only, not project protocol values.
const EXAMPLE: RegistryEntry[] = [
  {
    canId: 0x7e0,
    identifierFormat: 'standard',
    name: 'EXAMPLE verified',
    sender: 'EXAMPLE',
    receivers: 'EXAMPLE',
    periodMs: 100,
    trigger: 'periodic',
    dlc: 4,
    fields: [
      { name: 'ex_u16_be', startByte: 0, lengthBytes: 2, signed: false, byteOrder: 'big_endian', scaling: { factor: 0.1, offset: 0, unit: 'ex' } },
      { name: 'ex_s16_le', startByte: 2, lengthBytes: 2, signed: true, byteOrder: 'little_endian', scaling: null },
    ],
    counterChecksum: 'none',
    evidence: 'EXAMPLE',
    status: 'verified',
  },
];

const f = (canId: string, data: number[], extra: Partial<{ remote: boolean; identifierFormat: 'standard' | 'extended' }> = {}) => ({
  canId,
  data,
  dlc: data.length,
  remote: false,
  identifierFormat: 'standard' as const,
  ...extra,
});

describe('decoder', () => {
  it('has no production registry entries yet', () => {
    expect(PRODUCTION_REGISTRY).toHaveLength(0);
  });

  it('keeps unknown IDs as unknown', () => {
    expect(decodeFrame(f('0x123', [1, 2])).status).toBe('unknown');
  });

  it('decodes verified EXAMPLE entries, physical only where scaling is known', () => {
    const r = decodeFrame(f('0x7E0', [0x01, 0xf4, 0xf6, 0xff]), EXAMPLE);
    expect(r.status).toBe('decoded');
    expect(r.fields[0]).toMatchObject({ raw: 500, physical: 50, unit: 'ex' });
    expect(r.fields[1]).toMatchObject({ raw: -10, physical: null });
    expect(isVerifiedFrame(f('0x7E0', [0, 0, 0, 0]), EXAMPLE)).toBe(true);
  });

  it('flags DLC/RTR mismatches without decoding', () => {
    expect(decodeFrame(f('0x7E0', [1, 2, 3]), EXAMPLE).status).toBe('mismatch');
    expect(decodeFrame(f('0x7E0', [], { remote: true }), EXAMPLE).status).toBe('mismatch');
  });

  it('treats standard and extended IDs as distinct', () => {
    expect(decodeFrame(f('0x000007E0', [0, 0, 0, 0], { identifierFormat: 'extended' }), EXAMPLE).status).toBe('unknown');
  });

  it('marks legacy test-sketch IDs unverified with raw values only', () => {
    expect(LEGACY_TEST_SKETCH_REGISTRY.every((e) => e.status === 'unverified')).toBe(true);
    const r = decodeFrame(f('0x201', [0x01, 0xe0]));
    expect(r.status).toBe('unverified');
    expect(r.fields[0]).toMatchObject({ name: 'voltage_raw', raw: 480, physical: null });
    expect(decodeFrame(f('0x202', [0xff, 0x88])).fields[0].raw).toBe(-120);
    expect(isVerifiedFrame(f('0x201', [0x01, 0xe0]))).toBe(false);
  });

  it('refuses multi-byte fields with unverified byte order', () => {
    expect(extractRaw([1, 2], { name: 'x', startByte: 0, lengthBytes: 2, signed: false, byteOrder: 'unverified', scaling: null })).toBeNull();
  });
});
