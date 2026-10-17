// @vitest-environment node
// Dashboard protocol helpers vs the generator's golden vectors (the same
// bytes the C++ firmware codec is tested against), and command validation
// that mirrors the firmware's exact decimal parser.
import { describe, expect, it } from 'vitest';

import {
  COMMAND_PARAMS,
  checksum,
  decodeV1,
  encodeFields,
  expectedDetections,
  messageById,
  validateCommandValue,
} from '../src/lib/protocol';
import { DEMO_FAULTS, FAULTS, SERIAL, TIMING } from '../src/lib/protocol-spec.generated';
import { PROTOCOL_VECTORS } from './protocol-vectors.generated';

const frame = (canId: number, data: number[], extra: Partial<{ dlc: number; remote: boolean; identifierFormat: 'standard' | 'extended' }> = {}) => ({
  canId,
  identifierFormat: 'standard' as const,
  remote: false,
  dlc: data.length,
  data,
  ...extra,
});

describe('protocol v1 (dashboard side)', () => {
  it('encodes and decodes every golden vector identically to the generator', () => {
    expect(PROTOCOL_VECTORS.length).toBeGreaterThanOrEqual(10);
    for (const v of PROTOCOL_VECTORS) {
      const msg = messageById(v.canId)!;
      const raw = Object.fromEntries(msg.fields.map((f, i) => [f.key, v.values[i]]));
      expect(encodeFields(msg, raw, v.counter), v.label).toEqual([...v.bytes]);
      const d = decodeV1(frame(v.canId, [...v.bytes]))!;
      expect(d.check, v.label).toBe('ok');
      expect(d.counter).toBe(v.counter);
      msg.fields.forEach((f, i) => expect(d.raw[f.key]).toBe(v.values[i]));
    }
  });

  it('rejects malformed frames the same way Node 3 does', () => {
    const good = [0x05, 0xdc, 0x02, 0x8a, 0, 0, 0, 0x71];
    expect(decodeV1(frame(0x120, good))!.physical).toEqual({ rpm: 1500, motorTempC: 65 });
    expect(decodeV1(frame(0x120, good.slice(0, 4)))!.check).toBe('bad_dlc');
    expect(decodeV1(frame(0x120, good, { remote: true }))!.check).toBe('remote_frame');
    expect(decodeV1(frame(0x120, [...good.slice(0, 7), 0x70]))!.check).toBe('bad_checksum');
    expect(decodeV1(frame(0x120, good, { identifierFormat: 'extended' }))).toBeNull();
    expect(decodeV1(frame(0x201, [1, 0xe0]))).toBeNull(); // legacy test ID: not v1

    const msg = messageById(0x120)!;
    expect(decodeV1(frame(0x120, encodeFields(msg, { rpm: 0xffff, motorTempC: 0 }, 0)))!.check).toBe('value_out_of_range');
    const hb = messageById(0x701)!;
    const base = { protocolVersion: 1, nodeId: 1, fwMajor: 1, fwMinor: 0, fwPatch: 0, canState: 0 };
    expect(decodeV1(frame(0x701, encodeFields(hb, base, 0)))!.check).toBe('ok');
    expect(decodeV1(frame(0x701, encodeFields(hb, { ...base, protocolVersion: 99 }, 0)))!.check).toBe('unsupported_version');
    expect(decodeV1(frame(0x701, encodeFields(hb, { ...base, nodeId: 2 }, 0)))!.check).toBe('bad_node_id');
    expect(decodeV1(frame(0x701, encodeFields(hb, { ...base, canState: 3 }, 0)))!.check).toBe('value_out_of_range');
    // Same precedence as the firmware: version before range.
    expect(decodeV1(frame(0x701, encodeFields(hb, { ...base, protocolVersion: 99, canState: 3 }, 0)))!.check).toBe('unsupported_version');
    expect(checksum(0x120, [0, 0, 0, 0, 0, 0, 0])).toBe(222);
  });

  it('validates command values exactly like the firmware parser', () => {
    const p = (node: string, param: string) => COMMAND_PARAMS.find((c) => c.node === node && c.param === param)!;
    const rpm = p('node1', 'rpm');
    const temp = p('node1', 'temp');
    const volt = p('node2', 'voltage');
    expect(validateCommandValue(rpm, '3000')).toEqual({ ok: true, text: '3000' });
    expect(validateCommandValue(rpm, ' 8000 ')).toEqual({ ok: true, text: '8000' });
    expect(validateCommandValue(rpm, '8001')).toEqual({ ok: false, reason: 'out of range 0..8000 rpm' });
    expect(validateCommandValue(rpm, '-1').ok).toBe(false);
    expect(validateCommandValue(rpm, '1.5')).toEqual({ ok: false, reason: 'at most 0 decimal places' });
    expect(validateCommandValue(temp, '-40.0').ok).toBe(true);
    expect(validateCommandValue(temp, '150.1')).toEqual({ ok: false, reason: 'out of range -40.0..150.0 °C' });
    expect(validateCommandValue(temp, '20.25').ok).toBe(false);
    expect(validateCommandValue(volt, '48.05').ok).toBe(true);
    for (const bad of ['', '1e3', '0x10', 'abc', '1.', '.5', '1.2.3', 'NaN', 'Infinity', '12 3']) {
      expect(validateCommandValue(rpm, bad).ok, bad).toBe(false);
    }
  });

  it('carries the spec tables used by the UI', () => {
    expect(SERIAL.baud).toBe(460800);
    expect(TIMING.heartbeatTimeoutMs).toBe(1500);
    expect(FAULTS.find((f) => f.code === 'HEARTBEAT_LOST')?.severity).toBe('critical');
    expect(DEMO_FAULTS.map((d) => d.name)).toContain('bad_dlc');
    expect(expectedDetections('silent')).toEqual(['HEARTBEAT_LOST', 'TELEMETRY_STALE']);
    expect(expectedDetections('nonsense')).toEqual([]);
  });
});
