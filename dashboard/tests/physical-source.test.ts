// @vitest-environment node
// Physical-mode serial integration with an in-memory Web Serial double:
// discovery/selection, identification, malformed/oversized input, commands
// with ack/reject/unsupported/timeout, unplug + automatic reopen, port
// contention, duplicate fault events, identity conflicts, device restarts and
// forgetting unidentified ports.
import { describe, expect, it } from 'vitest';

import type { DataSourceHandlers } from '../src/lib/data-source';
import { PhysicalSource } from '../src/lib/serial/physical-source';
import type { CanScopeEvent } from '../src/types/events';
import { FakePort, FakeSerialApi, LINES, settle } from './fake-serial';

function setup(options: { granted?: FakePort[] } = {}) {
  const api = new FakeSerialApi();
  api.granted = options.granted ?? [];
  let now = 1_000_000;
  const events: CanScopeEvent[] = [];
  const connection: string[] = [];
  const source = new PhysicalSource(api, { now: () => now, tickMs: 1e9, ackTimeoutMs: 1500 });
  const handlers: DataSourceHandlers = {
    onEvent: (e) => events.push(e),
    onConnectionChange: (s, d) => connection.push(`${s}${d ? `: ${d}` : ''}`),
  };
  source.connect(handlers);
  return {
    api,
    source,
    events,
    connection,
    advance: (ms: number) => {
      now += ms;
    },
    async add(port: FakePort) {
      api.nextPick = port;
      const err = await source.addPort();
      await settle();
      return err;
    },
  };
}

describe('PhysicalSource', () => {
  it('reports an error and produces no data when Web Serial is unavailable', () => {
    const states: string[] = [];
    const events: CanScopeEvent[] = [];
    const s = new PhysicalSource(null);
    s.connect({ onEvent: (e) => events.push(e), onConnectionChange: (st, d) => states.push(`${st}: ${d}`) });
    expect(states[0]).toMatch(/^error: Web Serial is not available/);
    expect(s.getSnapshot().supported).toBe(false);
    expect(events).toHaveLength(0);
    s.disconnect();
  });

  it('starts fresh: previously granted ports are neither listed nor opened, even when replugged', async () => {
    const port = new FakePort();
    const t = setup({ granted: [port] });
    await settle();
    expect(t.source.getSnapshot().links).toEqual([]);
    t.api.fire('connect', port);
    await settle();
    expect(t.source.getSnapshot().links).toEqual([]);
    expect(port.opened).toBe(0);
    expect(port.forgotten).toBe(0); // the browser permission is kept
    expect(t.connection.at(-1)).toMatch(/^idle/);

    expect(await t.add(port)).toBeNull();
    expect(t.source.getSnapshot().links[0]).toMatchObject({ state: 'open', label: 'CP210x 10C4:EA60' });
  });

  it('clears the previous session on disconnect + connect and reopens nothing', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    port.emit(`${LINES.helloNode1}
`);
    await settle();
    expect(t.source.getSnapshot().links[0]).toMatchObject({ state: 'open', node: 'node1' });

    t.source.disconnect();
    await settle();
    expect(t.source.getSnapshot().links).toEqual([]);
    expect(port.isOpen).toBe(false);
    expect(port.forgotten).toBe(0);

    const connection: string[] = [];
    t.source.connect({ onEvent: () => {}, onConnectionChange: (s) => connection.push(s) });
    t.api.fire('connect', port);
    await settle();
    expect(t.source.getSnapshot().links).toEqual([]);
    expect(port.opened).toBe(1);
    expect(connection.at(-1)).toBe('idle');
    t.source.disconnect();
  });

  it('reopens ports closed earlier in the same session on request', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    const id = t.source.getSnapshot().links[0].id;
    await t.source.closeLink(id);
    await settle();
    expect(t.source.getSnapshot().links[0].state).toBe('closed');
    await t.source.openAllKnown();
    await settle();
    expect(port.opened).toBe(2);
    expect(t.connection.at(-1)).toMatch(/^connected/);
  });

  it('identifies a port from what the device says, and forwards parsed events', async () => {
    const t = setup();
    const port = new FakePort();
    expect(await t.add(port)).toBeNull();
    // Line split across chunks, plus a diagnostic and ROM-boot garbage.
    port.emit(LINES.helloNode1.slice(0, 50));
    port.emit(`${LINES.helloNode1.slice(50)}\r\n# CAN init: OK - controller running\nets Jun  8 2016 00:22:57\n`);
    await settle();
    t.source.tick(); // line counters are published on the periodic tick
    const link = t.source.getSnapshot().links[0];
    expect(link).toMatchObject({ node: 'node1', role: 'motor_ecu', firmware: '1.0.0', bootId: 'deadbeef', invalidLines: 1 });
    expect(link.diagnostics[0]).toMatch(/CAN init: OK/);
    expect(t.events.map((e) => e.type)).toEqual(['hello']);
    expect(t.events[0].link).toBe(link.id);
    expect(t.source.linkFor('node1')?.id).toBe(link.id);
  });

  it('drops oversized lines whole and counts them', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    port.emit(`{"type":"hello",${'x'.repeat(3000)}\n${LINES.helloNode2}\n`);
    await settle();
    t.source.tick();
    const link = t.source.getSnapshot().links[0];
    expect(link.overflows).toBe(1);
    expect(link.node).toBe('node2');
    expect(t.events).toHaveLength(1);
  });

  it('sends a command and reports success only on the device ack', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    port.emit(`${LINES.helloNode1}\n`);
    await settle();

    const rec = await t.source.sendCommand('node1', 'set rpm 3000');
    await settle();
    expect(rec.state).toBe('pending');
    expect(port.lines()).toEqual([`@${rec.id} set rpm 3000`]);
    expect(rec.id).toMatch(/^[A-Za-z0-9_-]{1,16}$/);

    port.emit(`${LINES.ack('node1', rec.id, 'ok', 'set rpm 3000', 'rpm=3000')}\n`);
    await settle();
    const done = t.source.getSnapshot().commands.find((c) => c.id === rec.id)!;
    expect(done).toMatchObject({ state: 'ok', detail: 'rpm=3000' });
    // A repeated ack changes nothing.
    port.emit(`${LINES.ack('node1', rec.id, 'rejected', 'set rpm 3000', 'dup')}\n`);
    await settle();
    expect(t.source.getSnapshot().commands.find((c) => c.id === rec.id)!.state).toBe('ok');
  });

  it('distinguishes rejected, unsupported and timed-out commands', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    port.emit(`${LINES.helloNode1}\n`);
    await settle();
    const a = await t.source.sendCommand('node1', 'set rpm 9000');
    const b = await t.source.sendCommand('node1', 'reboot');
    const c = await t.source.sendCommand('node1', 'status');
    await settle();
    port.emit(`${LINES.ack('node1', a.id, 'rejected', 'set rpm 9000', 'rpm out of range 0..8000 rpm')}\n`);
    port.emit(`${LINES.ack('node1', b.id, 'unsupported', 'reboot', 'unsupported command')}\n`);
    await settle();
    t.advance(1499);
    t.source.tick();
    const byId = (id: string) => t.source.getSnapshot().commands.find((x) => x.id === id)!;
    expect(byId(a.id).state).toBe('rejected');
    expect(byId(b.id).state).toBe('unsupported');
    expect(byId(c.id).state).toBe('pending');
    t.advance(1);
    t.source.tick();
    expect(byId(c.id)).toMatchObject({ state: 'timeout', detail: 'no acknowledgement within 1500 ms' });
    // A late ack is recorded but never turns a timeout into success.
    port.emit(`${LINES.ack('node1', c.id, 'ok', 'status', 'status sent')}\n`);
    await settle();
    expect(byId(c.id)).toMatchObject({ state: 'timeout', lateAck: 'ok: status sent' });
  });

  it('ignores an ack carrying the right id but coming from another node', async () => {
    const t = setup();
    const p1 = new FakePort();
    const p2 = new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    await t.add(p1);
    await t.add(p2);
    p1.emit(`${LINES.helloNode1}\n`);
    p2.emit(`${LINES.helloNode2}\n`);
    await settle();
    const r = await t.source.sendCommand('node1', 'fault bad_dlc');
    expect(p1.lines()).toEqual([`@${r.id} fault bad_dlc`]);
    expect(p2.lines()).toEqual([]);
    p2.emit(`${LINES.ack('node2', r.id, 'ok', 'fault bad_dlc', 'demoFault=bad_dlc', '0000beef')}\n`);
    await settle();
    expect(t.source.getSnapshot().commands[0].state).toBe('pending');
  });

  it('refuses to send to a node that is not connected, without writing anything', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    port.emit(`${LINES.helloMonitor}\n`);
    await settle();
    const r = await t.source.sendCommand('node2', 'set soc 50');
    expect(r).toMatchObject({ state: 'not_sent', detail: 'node2 is not connected (open its USB port first)' });
    const bad = await t.source.sendCommand('monitor', 'status\nfault silent');
    expect(bad.state).toBe('not_sent');
    expect(port.written).toEqual([]);
  });

  it('reports a busy port (serial-port contention) with an actionable message', async () => {
    const t = setup();
    const port = new FakePort();
    const busy = new Error('Failed to open serial port.');
    busy.name = 'NetworkError';
    port.openError = busy;
    await t.add(port);
    const link = t.source.getSnapshot().links[0];
    expect(link.state).toBe('error');
    expect(link.detail).toMatch(/port busy or unavailable - close any other serial monitor/);
    expect(t.connection.at(-1)).toMatch(/^error: port busy/);
  });

  it('marks pending commands lost on unplug and reopens automatically on replug', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    port.emit(`${LINES.helloNode1}\n`);
    await settle();
    const r = await t.source.sendCommand('node1', 'status');
    await settle();
    port.unplug();
    t.api.fire('disconnect', port);
    await settle();
    let snap = t.source.getSnapshot();
    expect(snap.links[0].state).toBe('lost');
    expect(snap.commands.find((c) => c.id === r.id)!.state).toBe('connection_lost');
    expect(t.connection.at(-1)).toMatch(/^disconnected/);
    expect(t.source.linkFor('node1')).toBeNull();

    t.api.fire('connect', port);
    await settle();
    snap = t.source.getSnapshot();
    expect(port.opened).toBe(2);
    expect(snap.links[0].state).toBe('open');
    expect(t.connection.at(-1)).toMatch(/^connected/);
  });

  it('does not reopen a port the user disconnected', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    const id = t.source.getSnapshot().links[0].id;
    await t.source.closeLink(id);
    t.api.fire('connect', port);
    await settle();
    expect(port.opened).toBe(1);
    expect(t.source.getSnapshot().links[0].state).toBe('closed');
  });

  it('processes each fault event once', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    const line = LINES.fault(5, 'HEARTBEAT_LOST', 'node1', 'active');
    port.emit(`${LINES.helloMonitor}\n${line}\n${line}\n${LINES.fault(6, 'HEARTBEAT_LOST', 'node1', 'cleared')}\n`);
    await settle();
    expect(t.events.filter((e) => e.type === 'fault').map((e) => (e.type === 'fault' ? e.eventId : 0))).toEqual([5, 6]);
  });

  it('blocks commands when two ports claim the same node', async () => {
    const t = setup();
    const a = new FakePort();
    const b = new FakePort();
    await t.add(a);
    await t.add(b);
    a.emit(`${LINES.helloNode1}\n`);
    b.emit(`${LINES.helloNode1}\n`);
    await settle();
    expect(t.source.getSnapshot().links.every((l) => l.conflict === '2 open ports identify as node1')).toBe(true);
    const r = await t.source.sendCommand('node1', 'status');
    expect(r.state).toBe('not_sent');
    expect(a.written).toEqual([]);
    expect(b.written).toEqual([]);
  });

  it('detects a device restart and fails commands the old boot can no longer answer', async () => {
    const t = setup();
    const port = new FakePort();
    await t.add(port);
    port.emit(`${LINES.helloNode1}\n`);
    await settle();
    const r = await t.source.sendCommand('node1', 'status');
    port.emit(`${LINES.helloNode1.replace('deadbeef', '12345678')}\n`);
    await settle();
    const snap = t.source.getSnapshot();
    expect(snap.links[0].restarts).toBe(1);
    expect(snap.commands.find((c) => c.id === r.id)).toMatchObject({
      state: 'connection_lost',
      detail: 'device restarted before acknowledging',
    });
  });

  describe('forgetPort', () => {
    async function withNodes() {
      const t = setup();
      const n1 = new FakePort();
      const n2 = new FakePort();
      const mon = new FakePort();
      for (const p of [n1, n2, mon]) await t.add(p);
      n1.emit(`${LINES.helloNode1}\n`);
      n2.emit(`${LINES.helloNode2}\n`);
      mon.emit(`${LINES.helloMonitor}\n`);
      await settle();
      return { ...t, n1, n2, mon };
    }

    it('closes an open unidentified port and removes it without touching identified nodes', async () => {
      const t = await withNodes();
      const stray = new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
      await t.add(stray);
      const id = t.source.getSnapshot().links.find((l) => l.node === null)!.id;
      expect(t.source.getSnapshot().links.find((l) => l.id === id)!.state).toBe('open');

      let published = 0;
      t.source.subscribe(() => published++);
      const done = t.source.forgetPort(id);
      // Removed from the snapshot before the close finishes.
      expect(published).toBeGreaterThan(0);
      expect(t.source.getSnapshot().links.map((l) => l.id)).not.toContain(id);
      expect(await done).toMatchObject({ removed: true, permission: 'revoked' });
      await settle();

      expect(stray.closed).toBeGreaterThan(0);
      expect(stray.forgotten).toBe(1);
      expect(stray.readable).toBeNull();
      const snap = t.source.getSnapshot();
      expect(snap.links.map((l) => l.node)).toEqual(['node1', 'node2', 'monitor']);
      expect(snap.links.every((l) => l.state === 'open')).toBe(true);
      for (const n of ['node1', 'node2', 'monitor'] as const) expect(t.source.linkFor(n)).not.toBeNull();
      const r = await t.source.sendCommand('node2', 'status');
      expect(t.n2.lines()).toEqual([`@${r.id} status`]);
      expect(t.connection.at(-1)).toMatch(/^connected: 3 port/);
    });

    it('refuses to forget an identified node port', async () => {
      const t = await withNodes();
      const n1 = t.source.getSnapshot().links.find((l) => l.node === 'node1')!;
      expect(await t.source.forgetPort(n1.id)).toMatchObject({ removed: false, permission: 'not_attempted' });
      expect(await t.source.forgetPort('no-such-port')).toMatchObject({ removed: false });
      expect(t.source.getSnapshot().links).toHaveLength(3);
      expect(t.n1.closed).toBe(0);
      expect(t.source.linkFor('node1')?.id).toBe(n1.id);
    });

    it('forgets a port in the error state and clears the connection error', async () => {
      const t = setup();
      const port = new FakePort();
      const busy = new Error('Failed to open serial port.');
      busy.name = 'NetworkError';
      port.openError = busy;
      await t.add(port);
      const link = t.source.getSnapshot().links[0];
      expect(link.state).toBe('error');
      expect((await t.source.forgetPort(link.id)).removed).toBe(true);
      expect(t.source.getSnapshot().links).toEqual([]);
      expect(t.connection.at(-1)).toMatch(/^idle/);
    });

    it('forgets closed and lost ports', async () => {
      const closed = new FakePort();
      const t = setup();
      await t.add(closed);
      await t.source.closeLink(t.source.getSnapshot().links[0].id);
      await settle();
      const lost = new FakePort();
      await t.add(lost);
      lost.unplug();
      t.api.fire('disconnect', lost);
      await settle();
      const [a, b] = t.source.getSnapshot().links;
      expect([a.state, b.state]).toEqual(['closed', 'lost']);
      expect((await t.source.forgetPort(a.id)).removed).toBe(true);
      expect((await t.source.forgetPort(b.id)).removed).toBe(true);
      expect(t.source.getSnapshot().links).toEqual([]);
      expect(closed.opened).toBe(1);
    });

    it('releases a port that finishes opening after it was forgotten', async () => {
      const t = setup();
      const port = new FakePort();
      let release!: () => void;
      port.openGate = new Promise<void>((r) => (release = r));
      t.api.nextPick = port;
      const adding = t.source.addPort();
      await settle();
      const id = t.source.getSnapshot().links[0].id;
      expect(t.source.getSnapshot().links[0].state).toBe('opening');

      await t.source.forgetPort(id);
      expect(t.source.getSnapshot().links).toEqual([]);
      release();
      await adding;
      await settle();
      expect(port.opened).toBe(1);
      expect(port.readable).toBeNull(); // closed again right after opening
      expect(t.source.getSnapshot().links).toEqual([]);
      port.emit(`${LINES.helloNode1}\n`);
      await settle();
      expect(t.events).toEqual([]);
    });

    it('does not re-list a forgotten port until the user picks it again', async () => {
      const port = new FakePort();
      const t = setup();
      await t.add(port);
      const id = t.source.getSnapshot().links[0].id;
      await t.source.forgetPort(id);

      // The fake still grants it, as a browser without forget() would.
      t.api.fire('connect', port);
      t.api.fire('connect', { target: null } as unknown as FakePort); // triggers getPorts()
      await settle();
      expect(t.source.getSnapshot().links).toEqual([]);
      expect(port.opened).toBe(1);

      expect(await t.add(port)).toBeNull();
      const again = t.source.getSnapshot().links;
      expect(again).toHaveLength(1);
      expect(again[0].id).not.toBe(id);
      expect(again[0].state).toBe('open');
    });
  });

  describe('serial lifecycle', () => {
    it('releases a lost port so the reopen after a replug does not hit "already open"', async () => {
      const t = setup();
      const port = new FakePort();
      await t.add(port);
      port.unplug();  // read stream errors; no disconnect event yet
      await settle();
      expect(t.source.getSnapshot().links[0].state).toBe('lost');
      expect(port.isOpen).toBe(false);  // closed by the dashboard after the loss
      t.api.fire('connect', port);
      await settle();
      expect(t.source.getSnapshot().links[0]).toMatchObject({ state: 'open', detail: null });
    });

    it('a stale open that finishes after Disconnect + Connect cannot leave two handles or a wrong state', async () => {
      const t = setup();
      const port = new FakePort();
      let release!: () => void;
      port.openGate = new Promise<void>((r) => (release = r));
      t.api.nextPick = port;
      const first = t.source.addPort();
      await settle();
      const id = t.source.getSnapshot().links[0].id;
      await t.source.closeLink(id);  // Disconnect while still opening
      expect(t.source.getSnapshot().links[0].state).toBe('closed');
      const second = t.source.openLink(id);  // Connect again before the first open finished
      release();
      await first;
      await second;
      await settle();
      expect(port.opened).toBe(2);  // the stale open was closed again ...
      expect(port.closed).toBe(1);
      expect(port.isOpen).toBe(true);  // ... and exactly one handle is left
      expect(t.source.getSnapshot().links[0].state).toBe('open');
      port.emit(`${LINES.helloNode1}
`);
      await settle();
      expect(t.events.filter((e) => e.type === 'hello')).toHaveLength(1);  // one reader, not two
    });

    it('shows an open failure on the port card and keeps it out of the open count', async () => {
      const t = setup();
      const port = new FakePort();
      const denied = new Error('Access denied.');
      denied.name = 'SecurityError';
      port.openError = denied;
      await t.add(port);
      expect(t.source.getSnapshot().links[0]).toMatchObject({ state: 'error', detail: expect.stringMatching(/blocked by the browser/) });
      expect(t.connection.at(-1)).toMatch(/^error/);
    });

    it('reports whether forgetting a port really revoked the browser permission', async () => {
      const t = setup();
      const noApi = new FakePort();
      (noApi as { forget?: unknown }).forget = undefined;  // browser without port.forget()
      await t.add(noApi);
      const failing = new FakePort();
      failing.forget = async () => {
        throw new Error('not allowed');
      };
      await t.add(failing);
      const [a, b] = t.source.getSnapshot().links;
      expect(await t.source.forgetPort(a.id)).toMatchObject({ removed: true, permission: 'unsupported' });
      const r = await t.source.forgetPort(b.id);
      expect(r).toMatchObject({ removed: true, permission: 'failed' });
      expect(r.detail).toMatch(/did not revoke permission: not allowed/);
    });
  });
});
