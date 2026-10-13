// MOCK data source. Everything produced here is SIMULATED, carries
// origin: 'mock', and must never be mistaken for a capture.
//
// - 0x201/0x202/0x203/0x210 replay the constants hard-coded in the existing
//   sketch_node2_test.ino (a test sketch; units unknown, UNVERIFIED).
// - 0x7A0 and 0x18FEF100 are EXAMPLE IDs chosen to demonstrate "unknown" frames.
//   They are not project IDs.
// - Node 3 reports status only, with configStatus UNVERIFIED and CAN not
//   running: that is what the current Node 3 firmware does with its default
//   (unverified) config.

import type { CanDataSource, DataSourceHandlers } from '../lib/data-source';
import { isVerifiedFrame } from '../lib/decoder';
import type { BusState, CanFrameEvent, NodeStatusEvent } from '../types/events';

export type MockScenario = 'normal' | 'empty' | 'stale' | 'disconnected' | 'error' | 'bus_off';

export const MOCK_SCENARIOS: readonly MockScenario[] = [
  'normal',
  'empty',
  'stale',
  'disconnected',
  'error',
  'bus_off',
];

export interface MockSourceOptions {
  scenario?: MockScenario;
  tickMs?: number;
  connectDelayMs?: number;
  now?: () => Date;
}

interface MockFrameSpec {
  canId: string;
  identifierFormat: 'standard' | 'extended';
  everyTicks: number;
  data: (tick: number) => number[];
}

// Constants copied from sketch_node2_test.ino (voltage 480, current 120, soc 85, heartbeat 1).
const FRAME_SPECS: readonly MockFrameSpec[] = [
  { canId: '0x201', identifierFormat: 'standard', everyTicks: 4, data: () => [0x01, 0xe0] },
  { canId: '0x202', identifierFormat: 'standard', everyTicks: 4, data: () => [0x00, 0x78] },
  { canId: '0x203', identifierFormat: 'standard', everyTicks: 4, data: () => [85] },
  { canId: '0x210', identifierFormat: 'standard', everyTicks: 2, data: () => [1] },
  // EXAMPLE unknown traffic (not project IDs):
  { canId: '0x7A0', identifierFormat: 'standard', everyTicks: 3, data: (t) => [t & 0xff, 0, 0, 0, 0, 0, 0, 0xaa] },
  { canId: '0x18FEF100', identifierFormat: 'extended', everyTicks: 5, data: (t) => [(t * 7) & 0xff, 0x12, 0x34, 0x56] },
];

const STATUS_EVERY_TICKS = 4;

export class MockCanDataSource implements CanDataSource {
  readonly kind = 'mock' as const;
  readonly label: string;

  private readonly scenario: MockScenario;
  private readonly tickMs: number;
  private readonly connectDelayMs: number;
  private readonly now: () => Date;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private rxFrames: Record<string, number> = {};

  constructor(options: MockSourceOptions = {}) {
    this.scenario = options.scenario ?? 'normal';
    this.tickMs = options.tickMs ?? 250;
    this.connectDelayMs = options.connectDelayMs ?? 400;
    this.now = options.now ?? (() => new Date());
    this.label = `Mock data (${this.scenario})`;
  }

  connect(handlers: DataSourceHandlers): void {
    this.disconnect();
    this.tick = 0;
    this.rxFrames = {};
    handlers.onConnectionChange('connecting');

    this.timers.push(
      setTimeout(() => {
        if (this.scenario === 'error') {
          handlers.onConnectionChange('error', 'Simulated transport error (mock scenario "error")');
          return;
        }
        handlers.onConnectionChange('connected');
        this.interval = setInterval(() => this.step(handlers), this.tickMs);

        if (this.scenario === 'disconnected') {
          this.timers.push(
            setTimeout(() => {
              this.stopInterval();
              handlers.onConnectionChange('disconnected', 'Simulated link loss (mock scenario "disconnected")');
            }, this.tickMs * 8),
          );
        }
        if (this.scenario === 'stale') {
          // Keep the link "connected" but stop delivering events.
          this.timers.push(setTimeout(() => this.stopInterval(), this.tickMs * 8));
        }
      }, this.connectDelayMs),
    );
  }

  disconnect(): void {
    this.stopInterval();
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private stopInterval(): void {
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
  }

  private step(handlers: DataSourceHandlers): void {
    this.tick += 1;
    const t = this.tick;

    if (this.scenario !== 'empty') {
      const capturers = ['monitor', 'node1'];
      for (const spec of FRAME_SPECS) {
        if (t % spec.everyTicks !== 0) continue;
        for (const node of capturers) handlers.onEvent(this.frame(node, spec, t));
      }
    }

    if (t % STATUS_EVERY_TICKS === 0) {
      handlers.onEvent(this.status('monitor', 'listen_only', 'WORKING_ASSUMPTION', true));
      handlers.onEvent(this.status('node1', 'normal', 'WORKING_ASSUMPTION', true));
      handlers.onEvent(this.status('node3', 'listen_only', 'UNVERIFIED', false));
    }
  }

  private busState(running: boolean): BusState {
    if (!running) return 'stopped';
    if (this.scenario === 'bus_off' && this.tick > 8) return 'bus_off';
    return 'error_active';
  }

  private frame(node: string, spec: MockFrameSpec, t: number): CanFrameEvent {
    const data = spec.data(t);
    this.rxFrames[node] = (this.rxFrames[node] ?? 0) + 1;
    const event: CanFrameEvent = {
      type: 'frame',
      timestamp: this.now().toISOString(),
      deviceTimeUs: t * this.tickMs * 1000,
      sourceNode: node,
      canId: spec.canId,
      identifierFormat: spec.identifierFormat,
      remote: false,
      dlc: data.length,
      data,
      busState: this.busState(true),
      txErrorCount: 0,
      rxErrorCount: 0,
      verified: false,
      origin: 'mock',
    };
    event.verified = isVerifiedFrame(event);
    return event;
  }

  private status(
    node: string,
    mode: string,
    configStatus: NodeStatusEvent['configStatus'],
    running: boolean,
  ): NodeStatusEvent {
    const busOff = running && this.busState(true) === 'bus_off';
    return {
      type: 'status',
      timestamp: this.now().toISOString(),
      deviceTimeUs: this.tick * this.tickMs * 1000,
      sourceNode: node,
      busState: this.busState(running),
      driverRunning: running && !busOff,
      mode,
      txEnabled: false,
      bitrate: running ? 500000 : 0,
      configStatus,
      txErrorCount: busOff ? 256 : 0,
      rxErrorCount: 0,
      rxFrames: this.rxFrames[node] ?? 0,
      txFrames: 0,
      txFailed: 0,
      rxMissed: 0,
      busErrors: busOff ? 32 : 0,
      arbitrationLost: 0,
      busOffEvents: busOff ? 1 : 0,
      origin: 'mock',
    };
  }
}

export function scenarioFromUrl(search: string): MockScenario {
  const value = new URLSearchParams(search).get('scenario');
  return MOCK_SCENARIOS.includes(value as MockScenario) ? (value as MockScenario) : 'normal';
}
