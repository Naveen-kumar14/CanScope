import type { DecodeStatus } from '../lib/decoder';

const LABEL: Record<DecodeStatus, string> = {
  decoded: 'decoded',
  unverified: 'unverified',
  unknown: 'unknown ID',
  mismatch: 'mismatch',
};

const TITLE: Record<DecodeStatus, string> = {
  decoded: 'Matches a VERIFIED registry entry',
  unverified: 'Registry entry exists but has no verification evidence: raw values only',
  unknown: 'No registry entry: raw frame kept',
  mismatch: 'Registry entry exists but DLC/RTR does not match: raw frame kept',
};

export function DecoderStatusBadge({ status }: { status: DecodeStatus }) {
  return (
    <span className={`badge decode-${status}`} title={TITLE[status]}>
      {LABEL[status]}
    </span>
  );
}
