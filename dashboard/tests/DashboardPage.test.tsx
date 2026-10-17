import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from '../src/pages/DashboardPage';
import { FakeSource, frame, status } from './helpers';

function setup(kind: 'mock' | 'live' = 'mock') {
  const source = new FakeSource(kind);
  const utils = render(<DashboardPage source={source} flushMs={0} />);
  return { source, ...utils };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('never offers raw CAN transmission, and a mock source has no command controls', () => {
    setup();
    expect(screen.getByText(/No raw CAN transmit · allow-listed USB commands only/)).toBeInTheDocument();
    // Without a physical node there is nothing to command: no decorative buttons.
    expect(screen.getByTestId('controls-unavailable')).toHaveTextContent('Unavailable with mock data');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByRole('textbox').map((e) => e.getAttribute('placeholder'))).toEqual(['e.g. 0x201']);
    expect(screen.getAllByRole('combobox')).toHaveLength(2); // node + time range
    expect(document.querySelectorAll('form')).toHaveLength(0);
  });

  it('shows a mock-data indicator for mock sources and not for live ones', () => {
    setup('mock');
    expect(screen.getByTestId('data-origin')).toHaveTextContent('MOCK DATA');
    expect(screen.getByTestId('mock-banner')).toBeInTheDocument();
  });

  it('live source has no mock banner', () => {
    setup('live');
    expect(screen.getByTestId('data-origin')).toHaveTextContent('PHYSICAL · LIVE');
    expect(screen.queryByTestId('mock-banner')).toBeNull();
  });

  it('loading state', () => {
    const { source } = setup();
    act(() => source.setConnection('connecting'));
    expect(screen.getByTestId('state-loading')).toBeInTheDocument();
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Connecting');
  });

  it('no-data (empty) state', () => {
    const { source } = setup();
    act(() => source.setConnection('connected'));
    expect(screen.getByTestId('state-empty')).toBeInTheDocument();
    expect(screen.getByTestId('frames-none')).toBeInTheDocument();
    expect(screen.getByTestId('nodes-empty')).toBeInTheDocument();
    expect(screen.getByTestId('bus-state')).toHaveTextContent('Unknown');
  });

  it('renders mock frames, unknown and unverified IDs, and frame detail', () => {
    const { source } = setup();
    act(() => {
      source.setConnection('connected');
      source.emit(frame({ canId: '0x7A0', data: [0xaa, 0x01], dlc: 2 }));
      source.emit(frame({ canId: '0x201', data: [0x01, 0xe0], dlc: 2 }));
      source.emit(status({ sourceNode: 'monitor', rxFrames: 2 }));
    });
    const table = screen.getByTestId('frame-table');
    expect(within(table).getByText('0x7A0')).toBeInTheDocument();
    expect(within(table).getByText('AA 01')).toBeInTheDocument();
    expect(within(table).getByText('unknown ID')).toBeInTheDocument();
    expect(within(table).getByText('unverified')).toBeInTheDocument();
    expect(screen.queryByTestId('state-empty')).toBeNull();
    expect(screen.getByTestId('bus-state')).toHaveTextContent('Error active');
    expect(screen.getByTestId('counter-rx')).toHaveTextContent('2');

    fireEvent.click(within(table).getByText('0x201'));
    const detail = screen.getByTestId('frame-detail');
    expect(detail).toHaveTextContent('voltage_raw');
    expect(detail).toHaveTextContent('480');
    expect(detail).toHaveTextContent('not shown — scaling/units unverified');
    expect(detail).toHaveTextContent('MOCK frame');
  });

  it('filters frames by CAN ID', () => {
    const { source } = setup();
    act(() => {
      source.setConnection('connected');
      source.emit(frame({ canId: '0x7A0' }));
      source.emit(frame({ canId: '0x201', data: [1, 0xe0] }));
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. 0x201'), { target: { value: '201' } });
    const table = screen.getByTestId('frame-table');
    expect(within(table).queryByText('0x7A0')).toBeNull();
    expect(within(table).getByText('0x201')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('e.g. 0x201'), { target: { value: '0x999' } });
    expect(screen.getByTestId('frames-empty')).toBeInTheDocument();
  });

  it('shows a Node 3 health card when Node 3 reports', () => {
    const { source } = setup();
    act(() => {
      source.setConnection('connected');
      source.emit(status({ sourceNode: 'node3', driverRunning: false, busState: 'stopped', bitrate: 0, configStatus: 'UNVERIFIED' }));
    });
    const card = screen.getByTestId('node-node3');
    expect(card).toHaveTextContent('not running');
    expect(card).toHaveTextContent('UNVERIFIED');
    expect(card).toHaveTextContent('TX disabled');
  });

  it('stale state after events stop', () => {
    const { source } = setup();
    act(() => {
      source.setConnection('connected');
      source.emit(frame());
    });
    expect(screen.queryByTestId('state-stale')).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByTestId('state-stale')).toBeInTheDocument();
    expect(screen.getByTestId('frame-rate')).toHaveTextContent('0');
  });

  it('disconnected state keeps last values but marks them not live', () => {
    const { source } = setup();
    act(() => {
      source.setConnection('connected');
      source.emit(frame());
      source.setConnection('disconnected', 'Link lost');
    });
    expect(screen.getByTestId('state-disconnected')).toHaveTextContent('Link lost');
    expect(screen.getByTestId('frame-table')).toBeInTheDocument();
  });

  it('error state', () => {
    const { source } = setup();
    act(() => source.setConnection('error', 'Port unavailable'));
    expect(screen.getByTestId('state-error')).toHaveTextContent('Port unavailable');
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Connection error');
  });

  it('disconnects the source on unmount', () => {
    const { source, unmount } = setup();
    unmount();
    expect(source.disconnected).toBe(true);
  });
});
