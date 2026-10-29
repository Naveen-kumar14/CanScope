// Example frames for the Live CAN data panel while Node 3 has received none.
//
// Presentation only: built in the browser from the protocol definition (field
// defaults, counter, checksum), never received from the bus. They are not
// StoredFrames, never enter the dashboard state (frame store, RX counters,
// fault list), are never sent anywhere, and disappear as soon as Node 3
// reports a real frame.

import { PROTOCOL_VERSION } from './protocol-spec.generated';
import { encodeFields, messageById, unitLabel, type ProtocolMessage } from './protocol';

export interface ExampleFrame {
  canId: string;
  dlc: number;
  data: number[];
  message: string;
  values: string;
}

const HEARTBEAT = (nodeId: number) => ({ protocolVersion: PROTOCOL_VERSION, nodeId, fwMajor: 1, fwMinor: 0, fwPatch: 0, canState: 0 });

const SPECS: { canId: number; raw?: Record<string, number>; counter: number }[] = [
  { canId: 0x120, counter: 0x2a },
  { canId: 0x220, counter: 0x2a },
  { canId: 0x701, raw: HEARTBEAT(1), counter: 0x05 },
  { canId: 0x702, raw: HEARTBEAT(2), counter: 0x05 },
];

function defaults(msg: ProtocolMessage): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const f of msg.fields) raw[f.key] = f.default ?? f.validMin;
  return raw;
}

function describe(msg: ProtocolMessage, raw: Record<string, number>): string {
  return msg.fields
    .map((f) => `${f.key}=${(raw[f.key] * f.factor).toFixed(f.decimals)}${f.unit ? ` ${unitLabel(f.unit)}` : ''}`)
    .join(', ');
}

/** Motor telemetry 0x120, battery telemetry 0x220, heartbeats 0x701 / 0x702. */
export function exampleFrames(): ExampleFrame[] {
  return SPECS.map(({ canId, raw, counter }) => {
    const msg = messageById(canId);
    if (!msg) throw new Error(`no protocol message 0x${canId.toString(16)}`);
    const values = { ...defaults(msg), ...raw };
    return {
      canId: `0x${canId.toString(16).toUpperCase().padStart(3, '0')}`,
      dlc: msg.dlc,
      data: encodeFields(msg, values, counter),
      message: msg.name.toLowerCase().replace(/_/g, ' '),
      values: describe(msg, values),
    };
  });
}
