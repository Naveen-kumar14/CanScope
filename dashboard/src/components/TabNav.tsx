// Accessible tab list (WAI-ARIA tabs pattern): arrow keys, Home and End move
// between tabs; only the selected tab is in the Tab order.
import { useRef } from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Short status text after the label, e.g. a fault count. */
  badge?: { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } | null;
}

interface Props<T extends string> {
  tabs: readonly TabDef<T>[];
  selected: T;
  onSelect: (id: T) => void;
  label: string;
}

export const tabId = (id: string) => `tab-${id}`;
export const panelId = (id: string) => `panel-${id}`;

export function TabNav<T extends string>({ tabs, selected, onSelect, label }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (index: number) => {
    const i = (index + tabs.length) % tabs.length;
    onSelect(tabs[i].id);
    refs.current[i]?.focus();
  };
  return (
    <nav className="tab-nav">
      <div role="tablist" aria-label={label} className="tab-list">
        {tabs.map((t, i) => {
          const active = t.id === selected;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={active}
              aria-controls={panelId(t.id)}
              tabIndex={active ? 0 : -1}
              className="tab"
              data-testid={`tab-${t.id}`}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') move(i + 1);
                else if (e.key === 'ArrowLeft') move(i - 1);
                else if (e.key === 'Home') move(0);
                else if (e.key === 'End') move(tabs.length - 1);
                else return;
                e.preventDefault();
              }}
            >
              {t.label}
              {t.badge && <span className={`tab-badge tone-${t.badge.tone}`}>{t.badge.text}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function TabPanel({ id, selected, children }: { id: string; selected: boolean; children: React.ReactNode }) {
  return (
    <section role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={!selected} className="tab-panel" tabIndex={0}>
      {children}
    </section>
  );
}
