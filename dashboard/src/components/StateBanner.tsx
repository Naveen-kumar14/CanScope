import type { ViewState } from '../lib/dashboard-state';
import { formatAge } from '../lib/format';

interface Props {
  view: ViewState;
  origin: 'mock' | 'live';
  detail: string | null;
  lastEventAgeMs: number | null;
}

export function StateBanner({ view, origin, detail, lastEventAgeMs }: Props) {
  return (
    <>
      {origin === 'mock' && (
        <div className="banner banner-mock" role="note" data-testid="mock-banner">
          <strong>Simulated data.</strong> Not connected to ESP32 hardware. Frames below are generated
          in the browser; IDs 0x201–0x210 replay the constants in the legacy test sketch, other IDs are
          examples. Nothing shown here is a verified CAN definition.
        </div>
      )}
      {view === 'idle' && origin === 'live' && (
        <div className="banner banner-info" role="status" data-testid="state-idle">
          {detail ?? 'Not connected.'} Nothing below is live until a CANScope node reports.
        </div>
      )}
      {view === 'loading' && (
        <div className="banner banner-info" role="status" data-testid="state-loading">
          Connecting to data source…
        </div>
      )}
      {view === 'error' && (
        <div className="banner banner-bad" role="alert" data-testid="state-error">
          <strong>Data source error.</strong> {detail ?? 'Unknown error.'} Values shown, if any, are
          not current.
        </div>
      )}
      {view === 'disconnected' && (
        <div className="banner banner-bad" role="alert" data-testid="state-disconnected">
          <strong>Disconnected.</strong> {detail ?? 'The data source closed.'} Values below are the
          last received and are not live.
        </div>
      )}
      {view === 'stale' && (
        <div className="banner banner-warn" role="alert" data-testid="state-stale">
          <strong>Stale data.</strong> No events received{' '}
          {lastEventAgeMs !== null ? formatAge(lastEventAgeMs) : 'recently'}. The link is still open,
          but the values below are not current.
        </div>
      )}
    </>
  );
}
