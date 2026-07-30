import { useRef } from 'react';
import { cx } from './cx.js';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  badge?: string | number;
}

/**
 * Barra di tab accessibile: frecce per spostarsi, Home/End agli estremi,
 * `aria-selected` per gli screen reader. Prima l'app ne aveva due, disegnate
 * in modo diverso, entrambe fatte di bottoni senza semantica.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  label,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  label: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const i = items.findIndex((it) => it.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = items[next].id;
    onChange(id);
    refs.current[id]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex flex-wrap gap-1">
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[it.id] = el;
            }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.id)}
            className={cx(
              'rounded-[var(--radius-btn)] font-mono uppercase tracking-[0.08em] transition-colors duration-150',
              size === 'sm' ? 'px-2.5 py-1 text-[0.62rem]' : 'px-3 py-1.5 text-[0.68rem]',
              active ? 'bg-accent text-on-accent' : 'text-muted hover:bg-surface-3 hover:text-ink',
            )}
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {it.label}
            {it.badge !== undefined && <span className="ml-1.5 opacity-70">{it.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
