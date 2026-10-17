// Physical-mode page behaviour with an in-memory Web Serial double.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PhysicalSource } from '../src/lib/serial/physical-source';
import { DashboardPage } from '../src/pages/DashboardPage';
import { FakePort, FakeSerialApi, LINES, settle } from './fake-serial';

const ECU_STATE_FAULT =
  '{"type":"ecu_state","sourceNode":"node1","deviceTimeUs":4,"bootId":"deadbeef","role":"motor_ecu","canRunning":true,"busState":"error_active","profile":"static","demoFault":"heartbeat_stop","setpoint":{"rpm":1500,"motorTempC":65.0},"sent":{"rpm":1500,"motorTempC":65.0},"telemetryFrames":10,"heartbeatFrames":2,"txOk":12,"txFailed":0,"rxIgnored":0}';
const STATUS_MONITOR =
  '{"type":"status","sourceNode":"monitor","deviceTimeUs":1,"busState":"error_active","driverRunning":true,"mode":"normal","txEnabled":false,"bitrate":500000,"configStatus":"WORKING_ASSUMPTION","txErrorCount":0,"rxErrorCount":0,"rxFrames":5,"txFrames":0,"txFailed":0,"rxMissed":0,"busErrors":0,"arbitrationLost":0,"busOffEvents":0}';

async function setup() {
  const api = new FakeSerialApi();
  const source = new PhysicalSource(api, { tickMs: 1e9 });
  render(<DashboardPage source={source} physical={source} flushMs={0} />);
  const add = async (port: FakePort) => {
    api.nextPick = port;
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-port'));
      await settle();
    });
  };
  const emit = async (port: FakePort, ...lines: string[]) => {
    await act(async () => {
      port.emit(lines.map((l) => `${l}\n`).join(''));
      await settle();
      source.tick();
    });
  };
  return { api, source, add, emit };
}

describe('DashboardPage in physical mode', () => {
  it('starts idle with every node unconnected and every control disabled, never showing mock data', async () => {
    await setup();
    expect(screen.getByTestId('data-origin')).toHaveTextContent('PHYSICAL · LIVE');
    expect(screen.queryByTestId('mock-banner')).toBeNull();
    expect(screen.getByTestId('state-idle')).toBeInTheDocument();
    expect(screen.getByTestId('observed-node1-unavailable')).toHaveTextContent('Node 3 (monitor) is not connected');
    expect(screen.getByTestId('faults-unavailable')).toHaveTextContent('fault detection status is unknown');
    for (const n of ['node1', 'node2', 'monitor']) {
      expect(screen.getByTestId(`offline-${n}`)).toBeInTheDocument();
      const card = screen.getByTestId(`controls-${n}`);
      for (const b of within(card).getAllByRole('button')) expect(b).toBeDisabled();
    }
  });

  it('enables a node only after its port identifies, and validates locally before sending', async () => {
    const t = await setup();
    const port = new FakePort();
    await t.add(port);
    await t.emit(port, LINES.helloNode1);
    expect(screen.getByTestId('expected-node1')).toHaveTextContent('on CP210x 10C4:EA60');
    expect(screen.getByTestId('send-node1-rpm')).toBeEnabled();
    expect(screen.getByTestId('send-node2-voltage')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('node1 rpm'), { target: { value: '9000' } });
    fireEvent.click(screen.getByTestId('send-node1-rpm'));
    expect(screen.getByTestId('error-node1-rpm')).toHaveTextContent('Not sent: out of range 0..8000 rpm');
    expect(port.written).toEqual([]);

    fireEvent.change(screen.getByLabelText('node1 rpm'), { target: { value: '3000' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('send-node1-rpm'));
      await settle();
    });
    expect(port.lines()).toHaveLength(1);
    const [id, ...rest] = port.lines()[0].slice(1).split(' ');
    expect(rest.join(' ')).toBe('set rpm 3000');
    expect(screen.getByTestId(`cmd-state-${id}`)).toHaveTextContent('waiting for ack');
    await t.emit(port, LINES.ack('node1', id, 'ok', 'set rpm 3000', 'rpm=3000'));
    expect(screen.getByTestId(`cmd-state-${id}`)).toHaveTextContent('acknowledged');
  });

  it('shows a commanded demo fault as not detected until Node 3 independently reports it', async () => {
    const t = await setup();
    const ecu = new FakePort();
    const mon = new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
    await t.add(ecu);
    await t.add(mon);
    await t.emit(ecu, LINES.helloNode1, ECU_STATE_FAULT);
    expect(screen.getByTestId('commanded-node1')).toHaveTextContent('heartbeat_stop');
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('unknown — Node 3 not connected');

    await t.emit(mon, LINES.helloMonitor, STATUS_MONITOR);
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('not detected (yet)');
    expect(screen.getByTestId('faults-none')).toBeInTheDocument();

    await t.emit(mon, LINES.fault(1, 'HEARTBEAT_LOST', 'node1', 'active'));
    expect(screen.getByTestId('expect-node1-HEARTBEAT_LOST')).toHaveTextContent('detected by Node 3');
    expect(screen.getByTestId('fault-HEARTBEAT_LOST-node1')).toHaveTextContent('critical');

    await t.emit(mon, LINES.fault(2, 'HEARTBEAT_LOST', 'node1', 'cleared'));
    expect(screen.queryByTestId('fault-HEARTBEAT_LOST-node1')).toBeNull();
    expect(within(screen.getByTestId('fault-history')).getByText('recovered')).toBeInTheDocument();
  });

  it('shows serial-port contention as an error with the reason', async () => {
    const t = await setup();
    const port = new FakePort();
    const busy = new Error('Failed to open serial port.');
    busy.name = 'NetworkError';
    port.openError = busy;
    await t.add(port);
    expect(screen.getByTestId('state-error')).toHaveTextContent('port busy or unavailable');
  });

  it('forgets unidentified port cards individually while the three nodes stay connected', async () => {
    const t = await setup();
    const nodes = [new FakePort(), new FakePort(), new FakePort()];
    const strays = [new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 }), new FakePort()];
    const busy = new Error('Failed to open serial port.');
    busy.name = 'NetworkError';
    strays[1].openError = busy;
    for (const p of [...nodes, ...strays]) await t.add(p);
    await t.emit(nodes[0], LINES.helloNode1);
    await t.emit(nodes[1], LINES.helloNode2);
    await t.emit(nodes[2], LINES.helloMonitor);

    expect(screen.getAllByText('Unidentified port')).toHaveLength(2);
    // Identified node cards never offer Forget.
    const ids = t.source.getSnapshot().links.map((l) => l.id);
    for (const id of ids.slice(0, 3)) expect(screen.queryByTestId(`forget-${id}`)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`forget-${ids[3]}`));
      await settle();
    });
    expect(screen.queryByTestId(`link-${ids[3]}`)).toBeNull();
    expect(strays[0].readable).toBeNull();
    expect(screen.getAllByText('Unidentified port')).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId(`forget-${ids[4]}`));
      await settle();
    });
    expect(screen.queryByText('Unidentified port')).toBeNull();
    for (const n of ['node1', 'node2', 'monitor']) expect(screen.getByTestId(`expected-${n}`)).toHaveTextContent('on ');
    expect(screen.getByTestId('send-node1-rpm')).toBeEnabled();
  });

  it('reports the missing Web Serial API instead of falling back to mock data', () => {
    const source = new PhysicalSource(null);
    render(<DashboardPage source={source} physical={source} flushMs={0} />);
    expect(screen.getByTestId('serial-unsupported')).toHaveTextContent('nothing is simulated');
    expect(screen.getByTestId('state-error')).toHaveTextContent('Web Serial is not available');
    expect(screen.queryByTestId('mock-banner')).toBeNull();
  });
});
