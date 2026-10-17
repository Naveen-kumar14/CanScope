// One physical USB-serial port opened through the browser's Web Serial API.
//
// Web Serial (Chrome / Edge, secure context such as http://localhost) gives
// the page direct access to the ESP32's USB-UART bridge, so no separate local
// bridge process or native module is needed. The minimal interfaces below are
// declared here because TypeScript's DOM library does not include Web Serial;
// tests implement them with in-memory streams.

import { LineSplitter } from './line-splitter';

export interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPortLike {
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfoLike;
  /** Revokes the page's permission for the port (Chrome 103+; optional). */
  forget?(): Promise<void>;
}

export interface SerialApiLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: { filters?: SerialPortInfoLike[] }): Promise<SerialPortLike>;
  addEventListener(type: 'connect' | 'disconnect', listener: (event: Event) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: Event) => void): void;
}

export type PortState = 'closed' | 'opening' | 'open' | 'closing' | 'error' | 'lost';

export interface SerialLinkHandlers {
  onLine(line: string): void;
  onOverflow(count: number): void;
  onState(state: PortState, detail?: string): void;
}

/** Common USB-UART bridges on ESP32 DevKit boards (for labels only). */
export function describePort(info: SerialPortInfoLike): string {
  const vid = info.usbVendorId;
  const pid = info.usbProductId;
  if (vid === undefined) return 'serial port (no USB id)';
  const hex = (n: number | undefined) => (n ?? 0).toString(16).toUpperCase().padStart(4, '0');
  const chips: Record<number, string> = { 0x10c4: 'CP210x', 0x1a86: 'CH340/CH9102', 0x0403: 'FTDI', 0x303a: 'Espressif USB' };
  return `${chips[vid] ?? 'USB serial'} ${hex(vid)}:${hex(pid)}`;
}

export function explainOpenError(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'InvalidStateError') return 'port is already open in this page';
  if (name === 'NetworkError' || /failed to open/i.test(message)) {
    return 'port busy or unavailable - close any other serial monitor (Arduino IDE, PlatformIO, PuTTY) using it';
  }
  if (name === 'NotFoundError') return 'no port selected';
  if (name === 'SecurityError') return 'serial access blocked by the browser (needs http://localhost or https)';
  return message || 'could not open port';
}

export class SerialLink {
  private state: PortState = 'closed';
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly splitter: LineSplitter;
  private readonly encoder = new TextEncoder();
  private closingByUser = false;

  constructor(
    readonly port: SerialPortLike,
    private readonly handlers: SerialLinkHandlers,
    maxLineLength: number,
  ) {
    this.splitter = new LineSplitter(maxLineLength);
  }

  get current(): PortState {
    return this.state;
  }

  async open(baudRate: number): Promise<boolean> {
    if (this.state === 'open' || this.state === 'opening') return this.state === 'open';
    this.closingByUser = false;
    this.setState('opening');
    try {
      await this.port.open({ baudRate, bufferSize: 16384 });
    } catch (e) {
      if (!this.closingByUser) this.setState('error', explainOpenError(e));
      return false;
    }
    if (this.closingByUser) {
      // close() was called while the port was still opening: release it again.
      try {
        await this.port.close();
      } catch {
        /* already gone */
      }
      return false;
    }
    this.splitter.reset();
    this.setState('open');
    void this.readLoop();
    return true;
  }

  private async readLoop(): Promise<void> {
    while (this.state === 'open' && this.port.readable) {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const { lines, overflows } = this.splitter.push(value);
          if (overflows) this.handlers.onOverflow(overflows);
          for (const line of lines) this.handlers.onLine(line);
        }
      } catch (e) {
        // BreakError/FramingError/ParityError are recoverable: keep reading.
        const name = e instanceof Error ? e.name : '';
        if (!this.closingByUser && !['BreakError', 'FramingError', 'ParityError', 'BufferOverrunError'].includes(name)) {
          this.setState('lost', e instanceof Error ? e.message : 'device lost');
        }
      } finally {
        reader.releaseLock();
        this.reader = null;
      }
      if (this.closingByUser) break;
      if (!this.port.readable) break;
    }
    if (this.state === 'open' && !this.closingByUser) this.setState('lost', 'serial stream ended');
  }

  /** Writes one line (a newline is appended). Writes are serialised. */
  writeLine(text: string): Promise<void> {
    const run = async () => {
      if (this.state !== 'open' || !this.port.writable) throw new Error('port not open');
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(this.encoder.encode(`${text}\n`));
      } finally {
        writer.releaseLock();
      }
    };
    const p = this.writeChain.then(run, run);
    this.writeChain = p.catch(() => undefined);
    return p;
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.closingByUser = true;
    this.setState('closing');
    try {
      await this.reader?.cancel();
    } catch {
      /* already gone */
    }
    try {
      await this.writeChain;
      await this.port.close();
    } catch {
      /* unplugged ports cannot be closed cleanly */
    }
    this.setState('closed');
  }

  /** Called when the browser reports the USB device was unplugged. */
  markLost(): void {
    if (this.state === 'open' || this.state === 'opening') this.setState('lost', 'USB device disconnected');
  }

  private setState(state: PortState, detail?: string): void {
    this.state = state;
    this.handlers.onState(state, detail);
  }
}
