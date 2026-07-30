import type { ReactNode } from 'react';
import { Kicker } from './Kicker.js';

/**
 * Stato vuoto. Il corpo deve dire **cosa fare**, non solo che non c'è niente:
 * "nessun risultato" e "nessun risultato con questi filtri" sono due schermate
 * diverse e vanno scritte diversamente.
 */
export function EmptyState({
  kicker,
  title,
  children,
  action,
}: {
  kicker?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line px-6 py-10 text-center">
      {kicker && <Kicker as="div">{kicker}</Kicker>}
      <p className="mt-1 font-display text-lg text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        {title}
      </p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
