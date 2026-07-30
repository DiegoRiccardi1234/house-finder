import type { ReactNode } from 'react';
import { cx } from './cx.js';

type Tone = 'info' | 'ok' | 'warn' | 'danger';

const TONE: Record<Tone, string> = {
  info: 'bg-accent-soft text-ink border-accent/30',
  ok: 'bg-ok-soft text-ink border-ok/30',
  warn: 'bg-warn-soft text-ink border-warn/40',
  danger: 'bg-danger-soft text-ink border-danger/40',
};

/**
 * Messaggio di stato. Regola dell'app: il testo dice sempre **cosa fare**,
 * non solo cosa è andato storto — perciò `action` è di prima classe.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border px-3 py-2 text-sm',
        TONE[tone],
        className,
      )}
    >
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-soft">{children}</div>}
      </div>
      {action}
    </div>
  );
}
