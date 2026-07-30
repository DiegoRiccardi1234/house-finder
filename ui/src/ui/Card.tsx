import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.js';
import { Kicker } from './Kicker.js';

/**
 * Contenitore standard: nessuna ombra e nessun bordo marcato a riposo — la
 * gerarchia si costruisce cambiando superficie, non disegnando contorni.
 * L'ombra compare solo come feedback di hover sulle card interattive.
 */
export function Card({
  interactive = false,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      {...rest}
      className={cx(
        'rounded-[var(--radius-card)] bg-surface-2 border border-hair',
        interactive &&
          'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(20,24,26,0.08)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  kicker,
  title,
  action,
}: {
  kicker?: string;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-hair px-4 py-3">
      <div>
        {kicker && <Kicker as="div">{kicker}</Kicker>}
        <h3 className="mt-0.5 text-lg text-ink">{title}</h3>
      </div>
      {action}
    </div>
  );
}
