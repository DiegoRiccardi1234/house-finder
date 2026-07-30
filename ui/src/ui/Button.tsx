import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-surface-3 text-ink-soft hover:bg-surface-hi border border-hair',
  ghost: 'text-muted hover:text-ink hover:bg-surface-3',
  danger: 'bg-danger text-white hover:opacity-90',
};

const SIZE: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-[0.66rem] min-h-[30px]',
  md: 'px-3.5 py-2 text-[0.72rem] min-h-[38px]',
};

/**
 * Bottone unico dell'app. Prima ce n'erano sei scritti a mano, tutti leggermente
 * diversi. Label in mono spaziato come nel resto del sistema.
 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-btn)]',
        'font-mono font-medium uppercase tracking-[0.08em]',
        'transition-[background-color,color,transform,opacity] duration-150',
        'hover:-translate-y-px disabled:pointer-events-none disabled:opacity-45 disabled:hover:translate-y-0',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}
