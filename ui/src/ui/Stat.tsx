import type { ReactNode } from 'react';
import { cx } from './cx.js';
import { Kicker } from './Kicker.js';

/**
 * Numero grande + etichetta mono. `sub` serve a dichiarare la base del calcolo
 * ("su 170 con prezzo"): un numero senza base è una mezza verità.
 */
export function Stat({
  label,
  value,
  sub,
  tone = 'ink',
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'ink' | 'accent' | 'muted';
  className?: string;
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <Kicker as="div">{label}</Kicker>
      <p
        className={cx(
          'mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight',
          tone === 'accent' ? 'text-accent' : tone === 'muted' ? 'text-muted' : 'text-ink',
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-faint">{sub}</p>}
    </div>
  );
}
