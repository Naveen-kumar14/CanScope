// @vitest-environment node
// Contract with the firmware: the exact lines asserted by the C++ host tests
// (test/firmware_host/*.cpp) must parse, and corrupted variants must not.
import { describe, expect, it } from 'vitest';

import { parseSerialLine } from '../src/lib/serial-line-parser';

const at = new Date('2026-10-17T00:00:00.000Z');

const FW = {
  ack: '{"type":"ack","sourceNode":"node1","deviceTimeUs":42,"bootId":"0a1b2c3d","id":"c12","command":"set rpm 1500","status":"ok","detail":"rpm=1500"}',
  hello:
    '{"type":"hello","sourceNode":"node1","deviceTimeUs":7,"nodeId":1,"role":"motor_ecu","firmware":"1.0.0","bootId":"deadbeef","protocolVersion":1,"serialProtocolVersion":1,"commands":"hello status"}',
  telemetry:
    '{"type":"telemetry","sourceNode":"monitor","deviceTimeUs":77,"node":"node1","valid":true,"ageMs":50,"counter":10,"state":"ok","values":{"rpm":1500,"motorTempC":65.0}}',
  telemetryEmpty:
    '{"type":"telemetry","sourceNode":"monitor","deviceTimeUs":5,"node":"node1","valid":false,"ageMs":null,"counter":0,"state":"waiting","values":{}}',
  fault:
    '{"type":"fault","sourceNode":"monitor","deviceTimeUs":99,"bootId":"cafe0001","eventId":7,"code":"HEARTBEAT_LOST","node":"node1","severity":"critical","state":"active","detail":"no heartbeat for 1501 ms"}',
  faults:
    '{"type":"faults","sourceNode":"monitor","deviceTimeUs":3,"bootId":"cafe0001","lastEventId":0,"count":0,"active":[],"truncated":false}',
  frame:
    '{"type":"frame","sourceNode":"monitor","deviceTimeUs":12,"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":8,"data":[0,0,0,0,0,0,0,222],"busState":"error_active","txErrorCount":0,"rxErrorCount":0,"kind":"motor_telemetry","check":"ok","accepted":true}',
  ecuState:
    '{"type":"ecu_state","sourceNode":"node2","deviceTimeUs":4,"bootId":"00c0ffee","role":"battery_ecu","canRunning":true,"busState":"error_active","profile":"static","demoFault":"bad_dlc","setpoint":{"packVoltageV":41.50,"packCurrentA":12.0,"socPct":85},"sent":{"packVoltageV":41.50,"packCurrentA":12.0,"socPct":85},"telemetryFrames":1,"heartbeatFrames":1,"txOk":2,"txFailed":0,"rxIgnored":5}',
};

const ev = (line: string) => {
  const r = parseSerialLine(line, at, 'live', 'port1');
  if (r.kind !== 'event') throw new Error(`expected event, got ${JSON.stringify(r)}`);
  return r.event;
};
const bad = (line: string) => parseSerialLine(line, at);

describe('parseSerialLine: protocol v1 device lines', () => {
  it('parses every firmware line shape exactly', () => {
    expect(ev(FW.ack)).toMatchObject({ type: 'ack', id: 'c12', status: 'ok', detail: 'rpm=1500', link: 'port1' });
    expect(ev(FW.hello)).toMatchObject({ type: 'hello', role: 'motor_ecu', bootId: 'deadbeef', commands: ['hello', 'status'] });
    expect(ev(FW.telemetry)).toMatchObject({ node: 'node1', valid: true, ageMs: 50, values: { rpm: 1500, motorTempC: 65 } });
    expect(ev(FW.telemetryEmpty)).toMatchObject({ valid: false, ageMs: null, values: {} });
    expect(ev(FW.fault)).toMatchObject({ eventId: 7, code: 'HEARTBEAT_LOST', state: 'active', severity: 'critical' });
    expect(ev(FW.faults)).toMatchObject({ type: 'faults', active: [], truncated: false });
    expect(ev(FW.frame)).toMatchObject({ canId: '0x120', check: 'ok', accepted: true, verified: true });
    expect(ev(FW.ecuState)).toMatchObject({ demoFault: 'bad_dlc', setpoint: { packVoltageV: 41.5 }, txOk: 2 });
  });

  it('rejects malformed or inconsistent lines instead of guessing', () => {
    expect(bad(FW.ack.replace('"ok"', '"great"'))).toMatchObject({ kind: 'invalid', reason: 'ack: bad status' });
    expect(bad(FW.hello.replace('deadbeef', 'DEADBEEF'))).toMatchObject({ reason: 'hello: bad bootId' });
    expect(bad(FW.hello.replace('"sourceNode":"node1"', '"sourceNode":"node9"'))).toMatchObject({
      reason: 'hello: unknown sourceNode',
    });
    expect(bad(FW.telemetry.replace('"rpm":1500', '"rpm":"1500"'))).toMatchObject({ reason: 'telemetry: bad values' });
    expect(bad(FW.telemetry.replace('"node":"node1"', '"node":"monitor"'))).toMatchObject({ reason: 'telemetry: bad node' });
    expect(bad(FW.fault.replace('"eventId":7', '"eventId":-1'))).toMatchObject({ reason: 'fault: bad id' });
    expect(bad(FW.fault.replace('"state":"active"', '"state":"maybe"'))).toMatchObject({ reason: 'fault: bad state' });
    expect(bad(FW.faults.replace('"active":[]', '"active":[{"code":"X"}]'))).toMatchObject({ reason: 'faults: bad entry' });
    expect(bad(FW.ecuState.replace('"txOk":2', '"txOk":2.5'))).toMatchObject({ reason: 'ecu_state: bad txOk' });
    expect(bad(FW.telemetry.slice(0, 60))).toMatchObject({ reason: 'malformed JSON' }); // truncated line
    expect(bad('[1,2,3]')).toMatchObject({ kind: 'invalid' });
    expect(bad('{"type":"telemetry"}')).toMatchObject({ kind: 'invalid' });
  });
});

describe('parseSerialLine: CAN frame and status validation', () => {
  const STATUS =
    '{"type":"status","sourceNode":"node1","deviceTimeUs":9,"busState":"error_passive","driverRunning":true,"mode":"normal","txEnabled":true,"bitrate":500000,"configStatus":"WORKING_ASSUMPTION","txErrorCount":128,"rxErrorCount":0,"rxFrames":0,"txFrames":0,"txFailed":37,"rxMissed":0,"busErrors":12,"arbitrationLost":0,"busOffEvents":0,"transceiverCheck":"no_echo"}';
  const frame = (fields: string) =>
    `{"type":"frame","sourceNode":"monitor","deviceTimeUs":1,${fields},"busState":"error_active"}`;

  it('accepts classical CAN frames whose payload matches the DLC', () => {
    expect(ev(frame('"canId":"0x7FF","identifierFormat":"standard","remote":false,"dlc":0,"data":[]'))).toMatchObject({ dlc: 0 });
    expect(ev(frame('"canId":"0x1FFFFFFF","identifierFormat":"extended","remote":false,"dlc":1,"data":[5]'))).toMatchObject({
      canId: '0x1FFFFFFF',
    });
    // DLC 9..15 is legal on a classical bus and carries 8 bytes.
    expect(ev(frame('"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":12,"data":[1,2,3,4,5,6,7,8]'))).toMatchObject({
      dlc: 12,
    });
    // A remote frame carries no data whatever its DLC.
    expect(ev(frame('"canId":"0x120","identifierFormat":"standard","remote":true,"dlc":8,"data":[]'))).toMatchObject({ remote: true });
  });

  it('rejects impossible frames instead of correcting them', () => {
    const reason = (fields: string) => (bad(frame(fields)) as { reason?: string }).reason;
    expect(reason('"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":8,"data":[1,2,3,4]')).toBe(
      'frame: 4 data bytes do not match DLC 8',
    );
    expect(reason('"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":4,"data":[1,2,3,4,5,6,7,8]')).toMatch(/do not match DLC 4/);
    expect(reason('"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":12,"data":[1,2,3,4,5,6,7,8,9,10,11,12]')).toMatch(
      /do not match DLC 12/,
    );
    expect(reason('"canId":"0x120","identifierFormat":"standard","remote":true,"dlc":2,"data":[1,2]')).toMatch(/remote frame/);
    expect(reason('"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":16,"data":[]')).toBe('frame: bad dlc');
    expect(reason('"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":1.5,"data":[1]')).toBe('frame: bad dlc');
    expect(reason('"canId":"0x20000000","identifierFormat":"extended","remote":false,"dlc":0,"data":[]')).toMatch(/out of range/);
    expect(reason('"canId":"0x00000000120","identifierFormat":"standard","remote":false,"dlc":0,"data":[]')).toBe('frame: bad canId');
    expect(reason('"canId":"0x120","identifierFormat":"fd","remote":false,"dlc":0,"data":[]')).toBe('frame: bad identifierFormat');
    expect(reason('"canId":"0x120","remote":false,"dlc":0,"data":[]')).toBe('frame: bad identifierFormat');
    expect(reason('"canId":"0x120","identifierFormat":"standard","dlc":0,"data":[]')).toBe('frame: bad remote flag');
    expect(reason('"canId":"0x120","identifierFormat":"standard","remote":false,"dlc":1,"data":[1],"txErrorCount":-1')).toBe(
      'frame: bad txErrorCount',
    );
  });

  it('parses a full status line, including the transceiver check', () => {
    expect(ev(STATUS)).toMatchObject({ type: 'status', txFailed: 37, txErrorCount: 128, transceiverCheck: 'no_echo' });
    // Older firmware without the field: reported as not available, not as a pass.
    expect(ev(STATUS.replace(',"transceiverCheck":"no_echo"', ''))).toMatchObject({ transceiverCheck: null });
  });

  it('never turns a missing or invalid diagnostic counter into zero', () => {
    expect(bad(STATUS.replace('"txFailed":37,', ''))).toMatchObject({ kind: 'invalid', reason: 'status: missing or invalid txFailed' });
    expect(bad(STATUS.replace('"rxFrames":0', '"rxFrames":null'))).toMatchObject({ reason: 'status: missing or invalid rxFrames' });
    expect(bad(STATUS.replace('"busErrors":12', '"busErrors":"12"'))).toMatchObject({ reason: 'status: missing or invalid busErrors' });
    expect(bad(STATUS.replace('"error_passive"', '"sleepy"'))).toMatchObject({ reason: 'status: bad busState' });
    expect(bad(STATUS.replace('"driverRunning":true', '"driverRunning":1'))).toMatchObject({ reason: 'status: bad flags' });
    expect(bad(STATUS.replace('"bitrate":500000', '"bitrate":-1'))).toMatchObject({ reason: 'status: bad bitrate' });
    expect(bad(STATUS.replace('"WORKING_ASSUMPTION"', '"PROBABLY"'))).toMatchObject({ reason: 'status: bad configStatus' });
    expect(bad(STATUS.replace('"no_echo"', '"fine"'))).toMatchObject({ reason: 'status: bad transceiverCheck' });
  });
});
