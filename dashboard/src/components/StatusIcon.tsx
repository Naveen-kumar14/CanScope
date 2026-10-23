// Small status glyphs so that a state is never shown by colour alone: each
// tone has its own shape (check, triangle, cross, ring). Always paired with a
// text label; the icon itself is hidden from screen readers.

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export function StatusIcon({ tone }: { tone: StatusTone }) {
  return (
    <svg className={`status-icon tone-${tone}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {tone === 'ok' && (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="var(--on-tone)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {tone === 'warn' && (
        <>
          <path d="M8 1.5l6.8 12.2H1.2z" fill="currentColor" strokeLinejoin="round" />
          <path d="M8 6v3.6" stroke="var(--on-tone)" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="0.95" fill="var(--on-tone)" />
        </>
      )}
      {tone === 'bad' && (
        <>
          <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" />
          <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" stroke="var(--on-tone)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {tone === 'info' && (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M8 7.2v4" stroke="var(--on-tone)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="4.8" r="1" fill="var(--on-tone)" />
        </>
      )}
      {tone === 'muted' && <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.6 2.2" />}
    </svg>
  );
}

/** Icon + text label with the tone colour; the text carries the meaning. */
export function StatusLabel({ tone, children, testId }: { tone: StatusTone; children: React.ReactNode; testId?: string }) {
  return (
    <span className={`status-label tone-${tone}`} data-testid={testId}>
      <StatusIcon tone={tone} />
      <span>{children}</span>
    </span>
  );
}
