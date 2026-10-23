// @vitest-environment node
// Line splitting of the raw serial byte stream and command tracking
// (ack / reject / unsupported / timeout / late ack / link loss), with an
// explicit clock.
import { describe, expect, it } from 'vitest';

import { CommandTracker, randomSessionTag } from '../src/lib/serial/command-tracker';
import { LineSplitter } from '../src/lib/serial/line-splitter';
import type { AckEvent } from '../src/types/events';

const enc = new TextEncoder();

describe('LineSplitter', () => {
  it('reassembles lines split anywhere, including inside a UTF-8 sequence', () => {
    const s = new LineSplitter(100);
    const bytes = enc.encode('temp 65°C\r\nnext');
    const cut = bytes.indexOf(0xc2) + 1; // split the two-byte "°"
    expect(s.push(bytes.slice(0, cut)).lines).toEqual([]);
    expect(s.push(bytes.slice(cut)).lines).toEqual(['temp 65°C']);
    expect(s.push(enc.encode(' line\n\n\r\n')).lines).toEqual(['next line']);
  });

  it('drops oversized lines whole (single chunk and across chunks) and recovers', () => {
    const s = new LineSplitter(10);
    expect(s.pushText('0123456789\n')).toEqual({ lines: ['0123456789'], overflows: 0 });
    expect(s.pushText('0123456789A\nok\n')).toEqual({ lines: ['ok'], overflows: 1 });
    expect(s.pushText('aaaaaa')).toEqual({ lines: [], overflows: 0 });
    expect(s.pushText('aaaaaa')).toEqual({ lines: [], overflows: 0 });
    expect(s.pushText('aaaa\nfine\n')).toEqual({ lines: ['fine'], overflows: 1 });
    s.pushText('partial');
    s.reset();
    expect(s.pushText('new\n').lines).toEqual(['new']);
  });
});

const ack = (id: string, status: AckEvent['status'], detail = ''): AckEvent => ({
  type: 'ack',
  timestamp: '',
  sourceNode: 'node1',
  origin: 'live',
  bootId: 'deadbeef',
  id,
  command: '',
  status,
  detail,
});

describe('CommandTracker', () => {
  it('resolves only on a matching ack from the addressed node', () => {
    const t = new CommandTracker(1500, 100, 'abc');
    const r = t.create('node1', 'set rpm 10', 0);
    expect(r.id).toBe('wabc1');
    expect(t.applyAck('node2', ack(r.id, 'ok'), 10)).toBe(false); // wrong node
    expect(t.applyAck('node1', ack('other', 'ok'), 10)).toBe(false); // unknown id
    expect(t.get(r.id)!.state).toBe('pending');
    expect(t.applyAck('node1', ack(r.id, 'ok', 'rpm=10'), 20)).toBe(true);
    expect(t.get(r.id)).toMatchObject({ state: 'ok', detail: 'rpm=10', resolvedAtMs: 20 });
    expect(t.applyAck('node1', ack(r.id, 'rejected'), 30)).toBe(false); // duplicate
    expect(t.get(r.id)!.state).toBe('ok');
  });

  it('times out exactly at the limit and records a late ack without success', () => {
    const t = new CommandTracker(1500, 100, 'x');
    const r = t.create('node1', 'status', 1000);
    expect(t.tick(2499)).toBe(0);
    expect(t.tick(2500)).toBe(1);
    expect(t.get(r.id)!.state).toBe('timeout');
    t.applyAck('node1', ack(r.id, 'ok', 'late'), 2600);
    expect(t.get(r.id)).toMatchObject({ state: 'timeout', lateAck: 'ok: late' });
  });

  it('fails pending commands of a node on link loss, and keeps a bounded log', () => {
    const t = new CommandTracker(1500, 3, 'x');
    const a = t.create('node1', 'a', 0);
    const b = t.create('node2', 'b', 0);
    expect(t.failNode('node1', 'link lost', 5)).toBe(1);
    expect(t.get(a.id)!.state).toBe('connection_lost');
    expect(t.get(b.id)!.state).toBe('pending');
    t.notSent('node2', 'c', 'not connected', 6);
    t.create('node2', 'd', 7);
    expect(t.list()).toHaveLength(3);
    expect(t.list()[0].text).toBe('d');
    const ids = new Set(t.list().map((r) => r.id));
    expect(ids.size).toBe(3);
  });

  it('ignores a delayed ack from another serial link or another device boot', () => {
    const t = new CommandTracker(1500, 100, 'abc');
    const r = t.create('node1', 'status', 0, { linkId: 'port2', bootId: 'deadbeef' });
    // Same id and node, but it arrived on a different port (e.g. a second board flashed as node1).
    expect(t.applyAck('node1', ack(r.id, 'ok'), 5, 'port7')).toBe(false);
    // Same port, but from an earlier boot of the device: not an answer to this command.
    expect(t.applyAck('node1', { ...ack(r.id, 'ok'), bootId: '0badf00d' }, 6, 'port2')).toBe(false);
    expect(t.get(r.id)!.state).toBe('pending');
    expect(t.applyAck('node1', ack(r.id, 'ok'), 7, 'port2')).toBe(true);
  });

  it('builds ids from a 6-character random session tag within the firmware id limit', () => {
    const tags = new Set(Array.from({ length: 200 }, () => randomSessionTag()));
    expect(tags.size).toBe(200);  // no collisions in 200 sessions
    for (const tag of tags) expect(tag).toMatch(/^[a-z0-9]{6}$/);
    const t = new CommandTracker(1500, 2000);
    let last = '';
    for (let i = 0; i < 1500; i++) last = t.create('node1', 'status', i).id;
    expect(last).toMatch(/^w[a-z0-9]{6}[a-z0-9]+$/);
    expect(last.length).toBeLessThanOrEqual(16);
  });
});
