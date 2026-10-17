// Physical-mode data source: the real Node 1, Node 2 and Node 3 boards over
// USB serial (Web Serial). Never produces data of its own and never falls back
// to mock data: if the browser has no Web Serial, the source reports an error.
//
// Responsibilities
// - one SerialLink per USB port; each link is identified by what the device
//   says about itself (hello/status lines), never by port order
// - parse every line strictly; count invalid and oversized lines per link
// - route commands only to the open, uniquely identified port of the target
//   node and track them until an ack, a timeout or a link loss
// - drop duplicate fault events (bootId + eventId)
// - reopen a port that was unplugged while the user wanted it open
// - forget unidentified ports on request and never re-list them on their own

import type { CanDataSource, ConnectionState, DataSourceHandlers } from '../data-source';
import { SERIAL } from '../protocol-spec.generated';
import { parseSerialLine } from '../serial-line-parser';
import type { CanScopeEvent, DeviceNode } from '../../types/events';
import { CommandTracker, type CommandRecord } from './command-tracker';
import {
  SerialLink,
  describePort,
  explainOpenError,
  type PortState,
  type SerialApiLike,
  type SerialPortLike,
} from './serial-link';

export interface LinkInfo {
  id: string;
  label: string;
  state: PortState;
  detail: string | null;
  wantOpen: boolean;
  node: DeviceNode | null;
  role: string | null;
  firmware: string | null;
  bootId: string | null;
  protocolVersion: number | null;
  lastLineAtMs: number | null;
  lines: number;
  invalidLines: number;
  overflows: number;
  lastInvalid: string | null;
  restarts: number;
  conflict: string | null;
  diagnostics: string[];
}

export interface PhysicalSnapshot {
  supported: boolean;
  unsupportedReason: string | null;
  links: LinkInfo[];
  commands: readonly CommandRecord[];
}

export interface PhysicalSourceOptions {
  baudRate?: number;
  ackTimeoutMs?: number;
  now?: () => number;
  tickMs?: number;
}

const DEVICE_NODES: readonly DeviceNode[] = ['node1', 'node2', 'monitor'];
const MAX_DIAGNOSTICS = 40;
const MAX_SEEN_FAULT_EVENTS = 2000;
const SAFE_COMMAND = /^[\x20-\x7E]+$/;

interface LinkEntry {
  info: LinkInfo;
  link: SerialLink;
  port: SerialPortLike;
}

export class PhysicalSource implements CanDataSource {
  readonly kind = 'live' as const;
  readonly label = 'USB serial (Web Serial)';

  private readonly baudRate: number;
  private readonly now: () => number;
  private readonly tickMs: number;
  private readonly tracker: CommandTracker;
  private handlers: DataSourceHandlers | null = null;
  private entries: LinkEntry[] = [];
  /** Ports the user forgot; only an explicit pick in addPort() brings one back. */
  private forgotten = new WeakSet<SerialPortLike>();
  private nextLinkId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: PhysicalSnapshot;
  private dirty = false;
  private seenFaults = new Set<string>();
  private seenOrder: string[] = [];
  private connection: ConnectionState = 'idle';
  private everConnected = false;

  constructor(
    private readonly api: SerialApiLike | null,
    options: PhysicalSourceOptions = {},
  ) {
    this.baudRate = options.baudRate ?? SERIAL.baud;
    this.now = options.now ?? (() => Date.now());
    this.tickMs = options.tickMs ?? 250;
    this.tracker = new CommandTracker(options.ackTimeoutMs ?? SERIAL.ackTimeoutMs);
    this.snapshot = this.buildSnapshot();
  }

  static fromBrowser(options?: PhysicalSourceOptions): PhysicalSource {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { serial?: SerialApiLike }) : undefined;
    return new PhysicalSource(nav?.serial ?? null, options);
  }

  // ------------------------------------------------------------ CanDataSource

  connect(handlers: DataSourceHandlers): void {
    this.handlers = handlers;
    if (!this.api) {
      this.setConnection(
        'error',
        'Web Serial is not available in this browser. Use Chrome or Edge on http://localhost (see dashboard/README.md). No data is shown.',
      );
      this.publish();
      return;
    }
    this.api.addEventListener('connect', this.onUsbConnect);
    this.api.addEventListener('disconnect', this.onUsbDisconnect);
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.setConnection('idle', 'No serial port open. Add a port to connect to a CANScope node.');
    void this.refreshGrantedPorts();
  }

  disconnect(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.api) {
      this.api.removeEventListener('connect', this.onUsbConnect);
      this.api.removeEventListener('disconnect', this.onUsbDisconnect);
    }
    for (const e of this.entries) {
      e.info.wantOpen = false;
      void e.link.close();
    }
    this.handlers = null;
  }

  // ------------------------------------------------------------- UI surface

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PhysicalSnapshot => this.snapshot;

  /** Opens the browser's port picker (must be called from a user gesture). */
  async addPort(): Promise<string | null> {
    if (!this.api) return 'Web Serial not available';
    let port: SerialPortLike;
    try {
      port = await this.api.requestPort();
    } catch (e) {
      return explainOpenError(e);
    }
    this.forgotten.delete(port);
    const entry = this.entryForPort(port) ?? this.addEntry(port);
    await this.openLink(entry.info.id);
    return null;
  }

  async openLink(id: string): Promise<void> {
    const e = this.entries.find((x) => x.info.id === id);
    if (!e) return;
    e.info.wantOpen = true;
    e.info.conflict = null;
    this.publish();
    await e.link.open(this.baudRate);
  }

  async closeLink(id: string): Promise<void> {
    const e = this.entries.find((x) => x.info.id === id);
    if (!e) return;
    e.info.wantOpen = false;
    await e.link.close();
  }

  /**
   * Removes an unidentified port: drops it from the snapshot at once, closes
   * it (also while it is still opening) and revokes the page's permission for
   * it where the browser supports that. Ports identified as a CANScope node
   * are never forgotten here.
   */
  async forgetPort(id: string): Promise<boolean> {
    const e = this.entries.find((x) => x.info.id === id);
    if (!e || e.info.node !== null) return false;
    e.info.wantOpen = false;
    this.entries = this.entries.filter((x) => x !== e);
    this.forgotten.add(e.port);
    this.updateConflicts();
    this.updateConnection();
    this.publish();
    await e.link.close();
    try {
      await e.port.forget?.();
    } catch {
      /* permission stays granted; the in-memory guard still applies */
    }
    return true;
  }

  async openAllKnown(): Promise<void> {
    await Promise.all(this.entries.filter((e) => e.link.current !== 'open').map((e) => this.openLink(e.info.id)));
  }

  /** The open, uniquely identified link for a node, if any. */
  linkFor(node: DeviceNode): LinkInfo | null {
    const matches = this.entries.filter((e) => e.info.node === node && e.link.current === 'open');
    return matches.length === 1 && !matches[0].info.conflict ? matches[0].info : null;
  }

  /**
   * Sends one allow-listed command line to a physical node. Resolves with the
   * tracked record; success is only ever set by the device's own ack.
   */
  async sendCommand(node: DeviceNode, text: string): Promise<CommandRecord> {
    const now = this.now();
    const trimmed = text.trim();
    if (!SAFE_COMMAND.test(trimmed) || trimmed.length + 18 > SERIAL.maxCommandLine) {
      const r = this.tracker.notSent(node, trimmed, 'command text is empty, too long or not printable ASCII', now);
      this.publish();
      return r;
    }
    const target = this.entries.filter((e) => e.info.node === node && e.link.current === 'open');
    if (target.length !== 1 || target[0].info.conflict) {
      const reason =
        target.length === 0
          ? `${node} is not connected (open its USB port first)`
          : `more than one port identifies as ${node}; resolve the conflict first`;
      const r = this.tracker.notSent(node, trimmed, reason, now);
      this.publish();
      return r;
    }
    const record = this.tracker.create(node, trimmed, now);
    this.publish();
    try {
      await target[0].link.writeLine(`@${record.id} ${trimmed}`);
    } catch (e) {
      this.tracker.fail(record.id, 'connection_lost', `write failed: ${e instanceof Error ? e.message : String(e)}`, this.now());
      this.publish();
    }
    return this.tracker.get(record.id) ?? record;
  }

  // ---------------------------------------------------------------- internals

  private async refreshGrantedPorts(): Promise<void> {
    if (!this.api) return;
    try {
      const ports = await this.api.getPorts();
      for (const p of ports) if (!this.forgotten.has(p) && !this.entryForPort(p)) this.addEntry(p);
      this.publish();
    } catch {
      /* permission state unavailable: the user can still add a port */
    }
  }

  private onUsbConnect = (event: Event) => {
    const port = (event.target ?? (event as unknown as { port?: SerialPortLike }).port) as SerialPortLike | null;
    if (!port || typeof (port as SerialPortLike).open !== 'function') {
      void this.refreshGrantedPorts();
      return;
    }
    if (this.forgotten.has(port)) return;
    const entry = this.entryForPort(port) ?? this.addEntry(port);
    entry.info.diagnostics = this.pushDiag(entry.info.diagnostics, 'USB device connected');
    if (entry.info.wantOpen) void this.openLink(entry.info.id);
    this.publish();
  };

  private onUsbDisconnect = (event: Event) => {
    const port = event.target as SerialPortLike | null;
    const entry = port ? this.entryForPort(port) : undefined;
    if (!entry) return;
    entry.link.markLost();
  };

  private entryForPort(port: SerialPortLike): LinkEntry | undefined {
    return this.entries.find((e) => e.port === port);
  }

  private addEntry(port: SerialPortLike): LinkEntry {
    const id = `port${this.nextLinkId++}`;
    const info: LinkInfo = {
      id,
      label: describePort(port.getInfo()),
      state: 'closed',
      detail: null,
      wantOpen: false,
      node: null,
      role: null,
      firmware: null,
      bootId: null,
      protocolVersion: null,
      lastLineAtMs: null,
      lines: 0,
      invalidLines: 0,
      overflows: 0,
      lastInvalid: null,
      restarts: 0,
      conflict: null,
      diagnostics: [],
    };
    const entry: LinkEntry = { info, port, link: null as unknown as SerialLink };
    // A forgotten entry may still report while it closes; ignore it.
    const live = () => this.entries.includes(entry);
    entry.link = new SerialLink(
      port,
      {
        onLine: (line) => {
          if (live()) this.onLine(entry, line);
        },
        onOverflow: (n) => {
          if (!live()) return;
          info.overflows += n;
          info.lastInvalid = `line longer than ${SERIAL.maxDeviceLine} characters dropped`;
          this.dirty = true;
        },
        onState: (state, detail) => {
          if (live()) this.onLinkState(entry, state, detail);
        },
      },
      SERIAL.maxDeviceLine,
    );
    this.entries.push(entry);
    return entry;
  }

  private onLinkState(entry: LinkEntry, state: PortState, detail?: string): void {
    const info = entry.info;
    info.state = state;
    info.detail = detail ?? null;
    const now = this.now();
    if (state === 'lost' || state === 'closed' || state === 'error') {
      if (info.node) {
        const n = this.tracker.failNode(info.node, state === 'closed' ? 'port closed' : `link ${state}: ${detail ?? ''}`.trim(), now);
        if (n) info.diagnostics = this.pushDiag(info.diagnostics, `${n} pending command(s) failed: link ${state}`);
      }
      if (state !== 'error') info.diagnostics = this.pushDiag(info.diagnostics, `port ${state}${detail ? `: ${detail}` : ''}`);
    }
    if (state === 'open') info.diagnostics = this.pushDiag(info.diagnostics, `port open at ${this.baudRate} baud`);
    this.updateConflicts();
    this.updateConnection();
    this.publish();
  }

  private onLine(entry: LinkEntry, line: string): void {
    const info = entry.info;
    const now = this.now();
    info.lines += 1;
    info.lastLineAtMs = now;
    this.dirty = true;

    const parsed = parseSerialLine(line, new Date(now), 'live', info.id);
    switch (parsed.kind) {
      case 'empty':
        return;
      case 'diagnostic':
        info.diagnostics = this.pushDiag(info.diagnostics, parsed.text);
        return;
      case 'invalid':
        // ESP32 ROM boot messages at 115200 baud arrive as garbage at 460800.
        info.invalidLines += 1;
        info.lastInvalid = `${parsed.reason}: ${line.slice(0, 60)}`;
        return;
      case 'event':
        this.onEvent(entry, parsed.event, now);
    }
  }

  private onEvent(entry: LinkEntry, event: CanScopeEvent, now: number): void {
    const info = entry.info;
    const claimed = DEVICE_NODES.includes(event.sourceNode as DeviceNode) ? (event.sourceNode as DeviceNode) : null;

    if (event.type === 'hello') {
      if (info.bootId && info.bootId !== event.bootId) {
        info.restarts += 1;
        info.diagnostics = this.pushDiag(info.diagnostics, `device restarted (boot ${info.bootId} -> ${event.bootId})`);
        if (info.node) this.tracker.failNode(info.node, 'device restarted before acknowledging', now);
      }
      info.bootId = event.bootId;
      info.role = event.role;
      info.firmware = event.firmware;
      info.protocolVersion = event.protocolVersion;
      this.publish();  // identity changes are rare and must show at once
    }
    if (claimed && info.node !== claimed) {
      if (info.node) info.diagnostics = this.pushDiag(info.diagnostics, `identity changed ${info.node} -> ${claimed}`);
      info.node = claimed;
      this.updateConflicts();
      this.publish();
    }

    if (event.type === 'ack') {
      if (info.node) this.tracker.applyAck(info.node, event, now);
      this.publish();  // command results must show at once
    }
    if (event.type === 'fault') {
      const key = `${event.bootId}:${event.eventId}`;
      if (this.seenFaults.has(key)) return;  // duplicate: never processed twice
      this.seenFaults.add(key);
      this.seenOrder.push(key);
      if (this.seenOrder.length > MAX_SEEN_FAULT_EVENTS) this.seenFaults.delete(this.seenOrder.shift()!);
    }
    this.handlers?.onEvent(event);
  }

  private updateConflicts(): void {
    for (const e of this.entries) e.info.conflict = null;
    for (const node of DEVICE_NODES) {
      const open = this.entries.filter((e) => e.info.node === node && e.link.current === 'open');
      if (open.length > 1) {
        for (const e of open) e.info.conflict = `${open.length} open ports identify as ${node}`;
      }
    }
  }

  private updateConnection(): void {
    const open = this.entries.filter((e) => e.link.current === 'open');
    if (open.length > 0) {
      this.everConnected = true;
      this.setConnection('connected', `${open.length} port(s) open`);
      return;
    }
    const errored = this.entries.find((e) => e.info.state === 'error' || e.info.state === 'lost');
    if (this.everConnected) {
      this.setConnection('disconnected', errored?.info.detail ?? 'All serial ports are closed.');
    } else if (errored) {
      this.setConnection('error', errored.info.detail ?? 'Could not open the serial port.');
    } else {
      this.setConnection('idle', 'No serial port open. Add a port to connect to a CANScope node.');
    }
  }

  private setConnection(state: ConnectionState, detail?: string): void {
    this.connection = state;
    this.handlers?.onConnectionChange(state, detail);
  }

  /** Expires command timeouts and publishes pending changes (runs every tickMs). */
  tick(): void {
    if (this.tracker.tick(this.now()) > 0) this.dirty = true;
    if (this.dirty) this.publish();
  }

  private pushDiag(list: string[], text: string): string[] {
    const stamp = new Date(this.now()).toISOString().slice(11, 23);
    return [`${stamp} ${text}`, ...list].slice(0, MAX_DIAGNOSTICS);
  }

  private buildSnapshot(): PhysicalSnapshot {
    return {
      supported: this.api !== null,
      unsupportedReason: this.api ? null : 'Web Serial API not available (use Chrome or Edge on http://localhost)',
      links: this.entries.map((e) => ({ ...e.info, diagnostics: [...e.info.diagnostics] })),
      commands: this.tracker.list(),
    };
  }

  private publish(): void {
    this.dirty = false;
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  /** For tests: current overall connection state. */
  get connectionState(): ConnectionState {
    return this.connection;
  }
}
