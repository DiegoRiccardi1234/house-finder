import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button.js';
import { Kicker } from './Kicker.js';

/**
 * Conferma per le azioni distruttive, al posto di `window.confirm`: quello non è
 * tematizzabile, non è testabile e su alcuni browser è bloccabile dall'utente.
 * Chiude con Escape, mette il focus sul pulsante di conferma, blocca il tab fuori.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmBtn.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = panel.current.querySelectorAll<HTMLElement>('button');
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-[var(--radius-card)] border border-hair bg-surface-2 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.3)]"
      >
        <Kicker as="div">Conferma</Kicker>
        <h2 id="confirm-title" className="mt-1 text-lg text-ink">
          {title}
        </h2>
        {children && <div className="mt-2 text-sm text-muted">{children}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmBtn}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
