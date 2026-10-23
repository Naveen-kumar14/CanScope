import { describe, expect, it } from 'vitest';

import { parseSerialLine } from '../src/lib/serial-line-parser';

const at = new Date('2026-10-13T00:00:00.000Z');

// Exact line asserted by test/firmware_host/test_raw_frame.cpp (EXAMPLE ID).
const FIRMWARE_FRAME_LINE =
  '{"type":"frame","sourceNode":"monitor","deviceTimeUs":1234567890123,"canId":"0x7A0",' +
  '"identifierFormat":"standard","remote":false,"dlc":3,"data":[0,127,255],' +
  '"busState":"error_active","txErrorCount":0,"rxErrorCount":5}';

describe('parseSerialLine', () => {
  it('parses the firmware frame line contract', () => {
    const r = parseSerialLine(FIRMWARE_FRAME_LINE, at);
    expect(r.kind).toBe('event');
    if (r.kind !== 'event' || r.event.type !== 'frame') throw new Error('expected frame');
    expect(r.event).toMatchObject({
      timestamp: '2026-10-13T00:00:00.000Z',
      sourceNode: 'monitor',
      canId: '0x7A0',
      identifierFormat: 'standard',
      dlc: 3,
      data: [0, 127, 255],
      busState: 'error_active',
      rxErrorCount: 5,
      verified: false,
      origin: 'live',
    });
  });

  it('parses status lines', () => {
    const line =
      '{"type":"status","sourceNode":"node3","deviceTimeUs":1000,"busState":"stopped","driverRunning":false,' +
      '"mode":"listen_only","txEnabled":false,"bitrate":0,"configStatus":"UNVERIFIED","txErrorCount":0,' +
      '"rxErrorCount":0,"rxFrames":0,"txFrames":0,"txFailed":0,"rxMissed":0,"busErrors":0,' +
      '"arbitrationLost":0,"busOffEvents":0}';
    const r = parseSerialLine(line, at);
    if (r.kind !== 'event' || r.event.type !== 'status') throw new Error('expected status');
    expect(r.event).toMatchObject({ sourceNode: 'node3', driverRunning: false, configStatus: 'UNVERIFIED' });
  });

  it('separates diagnostics and rejects garbage instead of inventing data', () => {
    expect(parseSerialLine('# CAN init: OK - controller running', at)).toEqual({
      kind: 'diagnostic',
      text: 'CAN init: OK - controller running',
    });
    expect(parseSerialLine('', at).kind).toBe('empty');
    expect(parseSerialLine('TWAI driver installed successfully', at).kind).toBe('invalid');
    expect(parseSerialLine('{not json', at).kind).toBe('invalid');
    expect(
      parseSerialLine('{"type":"frame","canId":"0x800","identifierFormat":"standard","remote":false,"dlc":0,"data":[]}', at),
    ).toMatchObject({
      kind: 'invalid',
      reason: 'frame: canId out of range for its format',
    });
    expect(
      parseSerialLine('{"type":"frame","canId":"0x100","identifierFormat":"standard","remote":false,"dlc":2,"data":[1,300]}', at),
    ).toMatchObject({
      kind: 'invalid',
      reason: 'frame: bad data',
    });
    expect(parseSerialLine('{"type":"command"}', at).kind).toBe('invalid');
  });

  it('normalises extended IDs to 8 hex digits', () => {
    const r = parseSerialLine(
      '{"type":"frame","canId":"0x18fef100","identifierFormat":"extended","remote":false,"dlc":0,"data":[]}',
      at,
    );
    if (r.kind !== 'event' || r.event.type !== 'frame') throw new Error('expected frame');
    expect(r.event.canId).toBe('0x18FEF100');
    expect(r.event.sourceNode).toBe('unknown');
  });
});
