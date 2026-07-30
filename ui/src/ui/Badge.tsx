import type { ReactNode } from 'react';
import { cx } from './cx.js';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted border-hair',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  accent: 'bg-accent-soft text-accent border-transparent',
};

/** Pill informativa. Sostituisce i chip riscritti a mano nelle card. */
export function Badge({
  tone = 'neutral',
  mono = false,
  children,
  className,
}: {
  tone?: Tone;
  mono?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] leading-tight',
        mono && 'font-mono uppercase tracking-[0.08em] text-[0.6rem]',
        TONE[tone],
        className,
      )}
      style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}
    >
      {children}
    </span>
  );
}
