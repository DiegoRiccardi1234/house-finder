import type { ReactNode } from 'react';
import { cx } from './cx.js';

/**
 * La micro-etichetta in maiuscoletto spaziato: è la firma tipografica dell'app.
 * Sta sopra ogni sezione, dentro i badge e nelle intestazioni di tabella.
 */
export function Kicker({
  children,
  as: Tag = 'span',
  tone = 'muted',
  className,
}: {
  children: ReactNode;
  as?: 'span' | 'div' | 'p' | 'h2' | 'h3';
  tone?: 'muted' | 'accent' | 'ink';
  className?: string;
}) {
  const color = tone === 'accent' ? 'text-accent' : tone === 'ink' ? 'text-ink' : 'text-muted';
  return (
    <Tag
      className={cx(
        'font-mono text-[0.62rem] font-medium uppercase tracking-[0.15em]',
        color,
        className,
      )}
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {children}
    </Tag>
  );
}
