// Example frames for the Live CAN data panel: valid protocol v1 frames built
// from the protocol definition, and plain presentation data (not StoredFrames).
import { describe, expect, it } from 'vitest';

import { exampleFrames } from '../src/lib/example-frames';
import { decodeV1 } from '../src/lib/protocol';

describe('exampleFrames', () => {
  const frames = exampleFrames();

  it('covers motor telemetry, battery telemetry and both heartbeats with 11-bit IDs and DLC 8', () => {
    expect(frames.map((f) => f.canId)).toEqual(['0x120', '0x220', '0x701', '0x702']);
    for (const f of frames) {
      expect(parseInt(f.canId, 16)).toBeLessThanOrEqual(0x7ff);
      expect(f.dlc).toBe(8);
      expect(f.data).toHaveLength(8);
      for (const b of f.data) expect(b >= 0 && b <= 255 && Number.isInteger(b)).toBe(true);
    }
  });

  it('passes the same validation as Node 3 (checksum, ranges, node id, version)', () => {
    for (const f of frames) {
      const d = decodeV1({ canId: parseInt(f.canId, 16), identifierFormat: 'standard', remote: false, dlc: f.dlc, data: f.data });
      expect(d?.check).toBe('ok');
    }
  });

  it('uses the protocol defaults', () => {
    expect(frames[0].values).toBe('rpm=1500 rpm, motorTempC=65.0 °C');
    expect(frames[1].values).toBe('packVoltageV=48.00 V, packCurrentA=12.0 A, socPct=85 %');
    expect(frames[2].values).toContain('nodeId=1');
    expect(frames[3].values).toContain('nodeId=2');
  });

  it('are not stored frames: no sequence number, receive time, source node or verdict', () => {
    for (const f of frames) {
      expect(Object.keys(f).sort()).toEqual(['canId', 'data', 'dlc', 'message', 'values']);
    }
  });
});
