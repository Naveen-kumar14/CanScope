// The four answers a first-time user needs at a glance: which boards are
// connected over USB, whether CAN frames arrive, which faults are active and
// what state the CAN controllers are in. USB state and CAN state are separate
// tiles on purpose: an open USB port says nothing about the CAN bus.
import { BUS_STATE_LABEL, BUS_STATE_TONE } from '../lib/format';
import { nodeLabel } from '../lib/protocol';
import type { BusState, DeviceNode, FaultSeverity } from '../types/events';
import { StatusIcon, StatusLabel, type StatusTone } from './StatusIcon';

interface Props {
  physical: boolean;
  usb: Record<DeviceNode, boolean>;
  monitorOnline: boolean;
  /** Node 3 has sent at least one complete fault list. */
  faultListReceived: boolean;
  frameRate: number;
  activeFaults: { severity: FaultSeverity }[];
  busState: BusState;
}

const DEVICES: DeviceNode[] = ['node1', 'node2', 'monitor'];

export function SystemStatus({ physical, usb, monitorOnline, faultListReceived, frameRate, activeFaults, busState }: Props) {
  const connected = DEVICES.filter((n) => usb[n]).length;
  const usbTone: StatusTone = !physical ? 'muted' : connected === 3 ? 'ok' : connected === 0 ? 'muted' : 'warn';

  let traffic: { tone: StatusTone; text: string };
  if (!monitorOnline) traffic = { tone: 'muted', text: 'Unknown — Node 3 not connected' };
  else if (frameRate > 0) traffic = { tone: 'ok', text: `Receiving ${Math.round(frameRate)} frames/s` };
  else traffic = { tone: 'warn', text: 'No CAN traffic received' };

  let faults: { tone: StatusTone; text: string };
  if (!monitorOnline) faults = { tone: 'muted', text: 'Unknown — Node 3 not connected' };
  else if (activeFaults.length === 0 && !faultListReceived) faults = { tone: 'muted', text: 'Waiting for Node 3’s fault list' };
  else if (activeFaults.length === 0) faults = { tone: 'ok', text: 'None active' };
  else {
    const critical = activeFaults.filter((f) => f.severity === 'critical').length;
    faults = {
      tone: critical > 0 ? 'bad' : 'warn',
      text: `${activeFaults.length} active${critical > 0 ? ` · ${critical} critical` : ''}`,
    };
  }

  return (
    <section className="system-status" aria-label="System status" data-testid="system-status">
      <div className="status-tile">
        <h3 className="tile-label">Boards on USB</h3>
        <StatusLabel tone={usbTone} testId="status-usb">
          {physical ? `${connected} of 3 connected` : 'Mock preview — no boards'}
        </StatusLabel>
        {physical && (
          <ul className="tile-list">
            {DEVICES.map((n) => (
              <li key={n} className={usb[n] ? '' : 'muted'}>
                <StatusIcon tone={usb[n] ? 'ok' : 'muted'} /> {nodeLabel(n)}
                <span className="visually-hidden">{usb[n] ? ': connected' : ': not connected'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="status-tile">
        <h3 className="tile-label">CAN traffic at Node 3</h3>
        <StatusLabel tone={traffic.tone} testId="status-traffic">
          {traffic.text}
        </StatusLabel>
        <p className="tile-note">Counted from frames the monitor actually received.</p>
      </div>
      <div className="status-tile">
        <h3 className="tile-label">Faults detected by Node 3</h3>
        <StatusLabel tone={faults.tone} testId="status-faults">
          {faults.text}
        </StatusLabel>
        <p className="tile-note">Independent of any fault you requested.</p>
      </div>
      <div className="status-tile">
        <h3 className="tile-label">Worst controller state</h3>
        <StatusLabel tone={busState === 'unknown' ? 'muted' : BUS_STATE_TONE[busState]} testId="status-bus">
          {busState === 'unknown' ? 'No status reported' : BUS_STATE_LABEL[busState]}
        </StatusLabel>
        <p className="tile-note">Error counters of every connected board.</p>
      </div>
    </section>
  );
}
