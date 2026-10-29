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
// - start fresh: every connect() begins with no ports listed. Ports granted in
//   an earlier session keep their browser permission (they are pre-selected in
//   the picker) but are never listed or opened until the user picks them again

import type { CanDataSource, ConnectionState, DataSourceHandlers } from '../data-source';
import { SERIAL } from '../protocol-spec.generated';
import { parseSerialLine } from '../serial-line-parser';
import type { CanScopeEvent, DeviceNode } from '../../types/events';
import { CommandTracker, type CommandRecord } from './command-tracker';
import { OledFaultSync, type OledUpdate } from './oled-sync';
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

export interface ForgetResult {
  removed: boolean;
  /** What happened to the browser's permission for the port. */
  permission: 'revoked' | 'unsupported' | 'failed' | 'not_attempted';
  detail: string;
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
  private nextLinkId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: PhysicalSnapshot;
  private dirty = false;
  private seenFaults = new Set<string>();
  private seenOrder: string[] = [];
  private oledSync = new OledFaultSync();
  /** Display commands sent to Node 3 and not yet reported back to oledSync. */
  private oledPending = new Map<string, OledUpdate>();
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
    this.resetSession();
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
    this.publish();
  }

  disconnect(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.api) {
      this.api.removeEventListener('connect', this.onUsbConnect);
      this.api.removeEventListener('disconnect', this.onUsbDisconnect);
    }
    const old = this.entries;
    this.entries = [];  // stale entries ignore anything they report while closing
    for (const e of old) {
      e.info.wantOpen = false;
      void e.link.close();
    }
    this.handlers = null;
    this.publish();
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
   * it (also while it is still opening) and asks the browser to revoke the
   * page's permission for it where port.forget() exists. The result says
   * whether that revocation really happened. Ports identified as a CANScope
   * node are never forgotten here.
   */
  async forgetPort(id: string): Promise<ForgetResult> {
    const e = this.entries.find((x) => x.info.id === id);
    if (!e) return { removed: false, permission: 'not_attempted', detail: 'port not found' };
    if (e.info.node !== null) {
      return { removed: false, permission: 'not_attempted', detail: `port identifies as ${e.info.node}; it is not forgotten` };
    }
    e.info.wantOpen = false;
    this.entries = this.entries.filter((x) => x !== e);
    this.updateConflicts();
    this.updateConnection();
    this.publish();
    await e.link.close();
    if (typeof e.port.forget !== 'function') {
      return {
        removed: true,
        permission: 'unsupported',
        detail: 'Removed for this session. This browser cannot revoke serial permission; it may list the port again after a reload.',
      };
    }
    try {
      await e.port.forget();
      return { removed: true, permission: 'revoked', detail: 'Removed and serial permission revoked.' };
    } catch (err) {
      // Unlisted ports are never re-added on their own, so it stays out of this session.
      return {
        removed: true,
        permission: 'failed',
        detail: `Removed for this session, but the browser did not revoke permission: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
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
    const record = this.tracker.create(node, trimmed, now, { linkId: target[0].info.id, bootId: target[0].info.bootId });
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

  /** Drops everything from an earlier session; browser permissions are left alone. */
  private resetSession(): void {
    this.entries = [];
    this.connection = 'idle';
    this.everConnected = false;
    this.seenFaults.clear();
    this.seenOrder = [];
    this.oledSync = new OledFaultSync();
    this.oledPending.clear();
  }

  /** Only ports picked in this session are tracked; any other port plugged in is ignored. */
  private onUsbConnect = (event: Event) => {
    const port = (event.target ?? (event as unknown as { port?: SerialPortLike }).port) as SerialPortLike | null;
    const entry = port ? this.entryForPort(port) : undefined;
    if (!entry) return;
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
        if (info.node === 'monitor') this.oledSync.onMonitorLost();
      }
      if (state !== 'error') info.diagnostics = this.pushDiag(info.diagnostics, `port ${state}${detail ? `: ${detail}` : ''}`);
    }
    if (state === 'open') info.diagnostics = this.pushDiag(info.diagnostics, `port open at ${this.baudRate} baud`);
    this.checkOledResults();
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
      if (info.node && this.tracker.applyAck(info.node, event, now, info.id)) {
        const r = this.tracker.get(event.id);
        if (r?.state === 'ok' && (r.node === 'node1' || r.node === 'node2')) this.oledSync.onEcuAck(r.node, r.text);
      }
      this.publish();  // command results must show at once
    }
    if (event.type === 'ecu_state' && (info.node === 'node1' || info.node === 'node2')) {
      this.oledSync.onEcuState(info.node, event.demoFault);
    }
    if (event.type === 'hello' && info.node === 'monitor') this.oledSync.onMonitorHello(event.bootId);
    this.checkOledResults();
    this.syncOled();
    if (event.type === 'fault') {
      const key = `${event.bootId}:${event.eventId}`;
      if (this.seenFaults.has(key)) return;  // duplicate: never processed twice
      this.seenFaults.add(key);
      this.seenOrder.push(key);
      if (this.seenOrder.length > MAX_SEEN_FAULT_EVENTS) this.seenFaults.delete(this.seenOrder.shift()!);
    }
    this.handlers?.onEvent(event);
  }

  /**
   * Tells Node 3's OLED what the ECUs were commanded (display only, see
   * oled-sync.ts). Each update is an ordinary tracked command: it counts as
   * shown only after Node 3's ok ack. Without a Node 3 link, a user-commanded
   * change is logged as not sent and goes out after Node 3 reconnects.
   */
  private syncOled(): void {
    if (!this.linkFor('monitor')) {
      const unsendable = this.oledSync.takeUnsendable();
      const now = this.now();
      for (const u of unsendable) {
        this.tracker.notSent('monitor', u.text, 'Node 3 not connected; sent when it reconnects', now);
      }
      if (unsendable.length > 0) this.publish();  // command results must show at once
      return;
    }
    for (const u of this.oledSync.take()) {
      void this.sendCommand('monitor', u.text).then((r) => {
        this.oledPending.set(r.id, u);
        this.checkOledResults();
      });
    }
  }

  /** Reports finished display commands (ok, rejected, unsupported, timeout, lost) to oledSync. */
  private checkOledResults(): void {
    for (const [id, u] of this.oledPending) {
      const r = this.tracker.get(id);
      if (r && r.state === 'pending') continue;
      this.oledPending.delete(id);
      this.oledSync.onResult(u, r ? r.state : 'connection_lost');
    }
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
    this.checkOledResults();
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
