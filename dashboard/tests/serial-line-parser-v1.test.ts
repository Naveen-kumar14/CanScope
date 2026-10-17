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
