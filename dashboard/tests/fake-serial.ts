// Test double for the browser Web Serial API: in-memory ports built from real
// web streams. It only stands in for the browser API; every line a test
// "receives" is written by the test itself (usually an exact firmware line).

import type { SerialApiLike, SerialPortLike } from '../src/lib/serial/serial-link';

export class FakePort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  written: string[] = [];
  opened = 0;
  openError: Error | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private readonly info = { usbVendorId: 0x10c4, usbProductId: 0xea60 }) {}

  async open(): Promise<void> {
    if (this.openError) throw this.openError;
    if (this.readable) {
      const e = new Error('The port is already open.');
      e.name = 'InvalidStateError';
      throw e;
    }
    this.opened += 1;
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(this.decoder.decode(chunk));
      },
    });
  }

  async close(): Promise<void> {
    this.readable = null;
    this.writable = null;
    this.controller = null;
  }

  getInfo() {
    return this.info;
  }

  /** Device -> host bytes, exactly as given (may split lines anywhere). */
  emit(text: string): void {
    this.controller?.enqueue(this.encoder.encode(text));
  }

  emitBytes(bytes: Uint8Array): void {
    this.controller?.enqueue(bytes);
  }

  /** Simulates the USB cable being pulled: the read stream errors. */
  unplug(): void {
    const e = new Error('The device has been lost.');
    e.name = 'NetworkError';
    this.controller?.error(e);
    this.readable = null;
    this.writable = null;
  }

  /** Lines the host wrote, without the trailing newline. */
  lines(): string[] {
    return this.written.join('').split('\n').filter(Boolean);
  }
}

export class FakeSerialApi implements SerialApiLike {
  granted: FakePort[] = [];
  nextPick: FakePort | null = null;
  private listeners: Record<string, ((e: Event) => void)[]> = { connect: [], disconnect: [] };

  async getPorts(): Promise<SerialPortLike[]> {
    return this.granted;
  }

  async requestPort(): Promise<SerialPortLike> {
    if (!this.nextPick) {
      const e = new Error('No port selected by the user.');
      e.name = 'NotFoundError';
      throw e;
    }
    const p = this.nextPick;
    this.nextPick = null;
    if (!this.granted.includes(p)) this.granted.push(p);
    return p;
  }

  addEventListener(type: 'connect' | 'disconnect', l: (e: Event) => void): void {
    this.listeners[type].push(l);
  }

  removeEventListener(type: 'connect' | 'disconnect', l: (e: Event) => void): void {
    this.listeners[type] = this.listeners[type].filter((x) => x !== l);
  }

  fire(type: 'connect' | 'disconnect', port: FakePort): void {
    const event = { type, target: port } as unknown as Event;
    for (const l of this.listeners[type]) l(event);
  }
}

/** Lets pending stream reads and promise chains run (no timers involved). */
export async function settle(rounds = 8): Promise<void> {
  // A macrotask hop via MessageChannel: no timer, no fixed delay.
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        r();
      };
      ch.port2.postMessage(null);
    });
  }
}

// Exact device lines, matching the firmware host tests' asserted output.
export const LINES = {
  helloNode1:
    '{"type":"hello","sourceNode":"node1","deviceTimeUs":7,"nodeId":1,"role":"motor_ecu","firmware":"1.0.0","bootId":"deadbeef","protocolVersion":1,"serialProtocolVersion":1,"commands":"hello status help recover set profile fault"}',
  helloNode2:
    '{"type":"hello","sourceNode":"node2","deviceTimeUs":7,"nodeId":2,"role":"battery_ecu","firmware":"1.0.0","bootId":"0000beef","protocolVersion":1,"serialProtocolVersion":1,"commands":"hello status help recover set profile fault"}',
  helloMonitor:
    '{"type":"hello","sourceNode":"monitor","deviceTimeUs":7,"nodeId":3,"role":"monitor","firmware":"1.0.0","bootId":"cafe0001","protocolVersion":1,"serialProtocolVersion":1,"commands":"hello status help recover faults frames silence"}',
  ack: (node: string, id: string, status: string, command: string, detail: string, bootId = 'deadbeef') =>
    `{"type":"ack","sourceNode":"${node}","deviceTimeUs":42,"bootId":"${bootId}","id":"${id}","command":"${command}","status":"${status}","detail":"${detail}"}`,
  fault: (eventId: number, code: string, node: string, state: 'active' | 'cleared', severity = 'critical') =>
    `{"type":"fault","sourceNode":"monitor","deviceTimeUs":99,"bootId":"cafe0001","eventId":${eventId},"code":"${code}","node":"${node}","severity":"${severity}","state":"${state}","detail":"test detail"}`,
};
