// Keeps Node 3's OLED in step with the demo fault each ECU was commanded.
//
// The monitor's "display" command only changes what its OLED shows. It is not
// a CAN frame, not an input to fault detection and never counted as one; the
// monitor's own fault/faults lines stay the only detection evidence.
//
// The wanted value per ECU comes from that ECU: its ok ack for "fault ..." and
// the demo fault it reports in ecu_state. A value counts as shown only once
// Node 3 acknowledged it (PhysicalSource reports each result back here):
// - rejected / unsupported: not retried until the value or the monitor boot
//   changes, so an old monitor firmware is not asked every second
// - timeout / connection lost / not sent: retried at Node 3's next hello
// - Node 3 link lost: everything is sent again once it says hello
// Pure and transport-free; PhysicalSource does the sending.

import { DEMO_FAULTS } from '../protocol-spec.generated';
import type { CommandState } from './command-tracker';
import type { EcuNode } from '../../types/events';

const ECUS: readonly EcuNode[] = ['node1', 'node2'];
const KNOWN = new Set<string>(['none', ...DEMO_FAULTS.map((d) => d.name)]);
const TRANSIENT: ReadonlySet<CommandState> = new Set<CommandState>(['timeout', 'connection_lost', 'not_sent']);

export interface OledUpdate {
  node: EcuNode;
  fault: string;
  text: string;
}

export function isDisplayCommand(text: string): boolean {
  return /^display( |$)/.test(text.trim());
}

function command(node: EcuNode, fault: string): string {
  return fault === 'none' ? `display clear ${node}` : `display fault ${node} ${fault}`;
}

export class OledFaultSync {
  private wanted: Record<EcuNode, string | null> = { node1: null, node2: null };
  /** Last value handed out for sending to the current monitor boot. */
  private sent: Record<EcuNode, string | null> = { node1: null, node2: null };
  private retry: Record<EcuNode, boolean> = { node1: false, node2: false };
  /** Changed by a user command and not yet sent or reported as unsendable. */
  private userChange: Record<EcuNode, boolean> = { node1: false, node2: false };
  private monitorBoot: string | null = null;
  private ready = false;

  /** "fault <name>" or "fault clear" acknowledged ok by an ECU. */
  onEcuAck(node: EcuNode, commandText: string): void {
    const m = /^fault (\S+)$/.exec(commandText.trim());
    if (m && this.want(node, m[1] === 'clear' ? 'none' : m[1])) this.userChange[node] = true;
  }

  /** The demo fault an ECU reports for itself (ecu_state). */
  onEcuState(node: EcuNode, demoFault: string): void {
    this.want(node, demoFault);
  }

  /** A monitor hello. A new boot starts empty, so everything is sent again. */
  onMonitorHello(bootId: string): void {
    this.ready = true;
    if (bootId !== this.monitorBoot) {
      this.monitorBoot = bootId;
      this.sent = { node1: null, node2: null };
      this.retry = { node1: false, node2: false };
      return;
    }
    for (const node of ECUS) {
      if (this.retry[node]) this.sent[node] = null;
      this.retry[node] = false;
    }
  }

  /** Node 3's port closed or was lost: resend everything after its next hello. */
  onMonitorLost(): void {
    this.ready = false;
    this.sent = { node1: null, node2: null };
    this.retry = { node1: false, node2: false };
  }

  /** Updates to send now; each is marked sent. Empty until Node 3 said hello. */
  take(): OledUpdate[] {
    if (!this.ready) return [];
    const out: OledUpdate[] = [];
    for (const node of ECUS) {
      const w = this.wanted[node];
      this.userChange[node] = false;
      // "none" is sent too: a monitor that ran before this page session may
      // still show a fault commanded from an earlier one.
      if (w === null || w === this.sent[node]) continue;
      this.sent[node] = w;
      out.push({ node, fault: w, text: command(node, w) });
    }
    return out;
  }

  /** User-commanded changes that cannot be sent because Node 3 is not ready; reported once each. */
  takeUnsendable(): OledUpdate[] {
    if (this.ready) return [];
    const out: OledUpdate[] = [];
    for (const node of ECUS) {
      const w = this.wanted[node];
      if (!this.userChange[node] || w === null) continue;
      this.userChange[node] = false;
      out.push({ node, fault: w, text: command(node, w) });
    }
    return out;
  }

  /** Final state of a display command sent for `update`. */
  onResult(update: OledUpdate, state: CommandState): void {
    if (!TRANSIENT.has(state) || this.sent[update.node] !== update.fault) return;
    this.retry[update.node] = true;
  }

  private want(node: EcuNode, fault: string): boolean {
    if (!KNOWN.has(fault)) return false;
    this.wanted[node] = fault;
    return true;
  }
}
