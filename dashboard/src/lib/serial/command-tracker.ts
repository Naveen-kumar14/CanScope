// Tracks commands sent to physical nodes until the device answers.
//
// A command is only ever reported 'ok' when the addressed device sent an ack
// line with the same id and status "ok". No ack within the timeout is a
// 'timeout'; a lost link is 'connection_lost'; nothing is assumed. Pure and
// clock-injected, so tests are deterministic.

import type { AckEvent, DeviceNode } from '../../types/events';

export type CommandState =
  | 'pending'
  | 'ok'
  | 'rejected'
  | 'unsupported'
  | 'timeout'
  | 'not_sent'
  | 'connection_lost';

export interface CommandRecord {
  id: string;
  node: DeviceNode;
  text: string;
  state: CommandState;
  detail: string;
  sentAtMs: number;
  resolvedAtMs: number | null;
  /** An ack that arrived after the command had already timed out or failed. */
  lateAck: string | null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

export class CommandTracker {
  private records: CommandRecord[] = [];
  private seq = 0;
  private readonly prefix: string;

  constructor(
    private readonly timeoutMs: number,
    private readonly maxRecords = 100,
    sessionTag = Math.floor(Math.random() * 36 ** 3).toString(36),
  ) {
    // Ids must be unique across page reloads so a late ack from a previous
    // session is never matched to a new command.
    this.prefix = `w${sessionTag.replace(/[^a-z0-9]/gi, '').slice(0, 4)}`;
  }

  create(node: DeviceNode, text: string, nowMs: number): CommandRecord {
    this.seq += 1;
    const id = `${this.prefix}${this.seq.toString(36)}`;
    if (!ID_PATTERN.test(id)) throw new Error(`invalid command id ${id}`);
    const record: CommandRecord = {
      id,
      node,
      text,
      state: 'pending',
      detail: 'waiting for acknowledgement',
      sentAtMs: nowMs,
      resolvedAtMs: null,
      lateAck: null,
    };
    this.records = [record, ...this.records].slice(0, this.maxRecords);
    return record;
  }

  /** Locally refused before anything was written to a port. */
  notSent(node: DeviceNode, text: string, reason: string, nowMs: number): CommandRecord {
    const r = this.create(node, text, nowMs);
    this.update(r.id, { state: 'not_sent', detail: reason, resolvedAtMs: nowMs });
    return this.get(r.id)!;
  }

  /**
   * Applies an ack from `fromNode`. Returns true if it resolved a pending
   * command. Acks with unknown ids, from the wrong node, or repeated acks
   * are ignored (late ones are recorded, never turned into success).
   */
  applyAck(fromNode: DeviceNode, ack: AckEvent, nowMs: number): boolean {
    const r = this.records.find((x) => x.id === ack.id);
    if (!r || r.node !== fromNode) return false;
    if (r.state !== 'pending') {
      if (r.lateAck === null && (r.state === 'timeout' || r.state === 'connection_lost')) {
        this.update(r.id, { lateAck: `${ack.status}: ${ack.detail}` });
      }
      return false;
    }
    this.update(r.id, { state: ack.status, detail: ack.detail, resolvedAtMs: nowMs });
    return true;
  }

  fail(id: string, state: 'connection_lost' | 'timeout', detail: string, nowMs: number): void {
    const r = this.get(id);
    if (r && r.state === 'pending') this.update(id, { state, detail, resolvedAtMs: nowMs });
  }

  /** All pending commands to a node fail, e.g. when its port is lost. */
  failNode(node: DeviceNode, detail: string, nowMs: number): number {
    let n = 0;
    for (const r of this.records) {
      if (r.node === node && r.state === 'pending') {
        this.update(r.id, { state: 'connection_lost', detail, resolvedAtMs: nowMs });
        n++;
      }
    }
    return n;
  }

  /** Expires pending commands; returns how many timed out. */
  tick(nowMs: number): number {
    let n = 0;
    for (const r of this.records) {
      if (r.state === 'pending' && nowMs - r.sentAtMs >= this.timeoutMs) {
        this.update(r.id, {
          state: 'timeout',
          detail: `no acknowledgement within ${this.timeoutMs} ms`,
          resolvedAtMs: nowMs,
        });
        n++;
      }
    }
    return n;
  }

  get(id: string): CommandRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  list(): readonly CommandRecord[] {
    return this.records;
  }

  private update(id: string, patch: Partial<CommandRecord>): void {
    this.records = this.records.map((r) => (r.id === id ? { ...r, ...patch } : r));
  }
}
