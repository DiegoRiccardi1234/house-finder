import type { ReactNode } from 'react';
import { cx } from './cx.js';

/**
 * La micro-etichetta sopra le sezioni. Era in maiuscolo spaziato da 10 px: "firma tipografica",
 * ma messa ovunque rendeva la Config una parete di etichette illeggibili. Ora è testo normale,
 * piccolo e nel carattere delle etichette: la gerarchia la fa il peso, non le maiuscole.
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
        'font-mono text-xs font-medium',
        color,
        className,
      )}
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {typeof children === 'string' ? children.charAt(0).toUpperCase() + children.slice(1) : children}
    </Tag>
  );
}
