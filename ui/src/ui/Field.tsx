import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from './cx.js';
import { Kicker } from './Kicker.js';

const CONTROL =
  'w-full rounded-[var(--radius-btn)] border border-line bg-surface-hi px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint disabled:opacity-50';

/**
 * Etichetta + controllo. Esiste perché i cinque `<select>` della barra filtri non
 * avevano alcuna label: erano leggibili solo a vista.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Riceve gli attributi da applicare al controllo (id e aria-describedby). */
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id}>
        <Kicker>{label}</Kicker>
      </label>
      {children({ id, 'aria-describedby': descId, 'aria-invalid': error ? true : undefined })}
      {(hint || error) && (
        <p id={descId} className={cx('text-xs', error ? 'text-danger' : 'text-faint')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx(CONTROL, className)} />;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CONTROL, className)} />;
}
