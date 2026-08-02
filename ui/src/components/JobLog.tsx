import type { JobState } from '../types';
import { Alert } from '../ui/Alert';
import { cx } from '../ui/cx';

/**
 * L'esito di un lavoro lungo, mostrato allo stesso modo ovunque.
 *
 * Le ultime righe si vedono solo mentre gira: a lavoro finito contano il verdetto e, se è andata
 * male, il perché. Un pannello che resta pieno di log dopo il successo dà l'impressione che
 * qualcosa sia ancora in sospeso.
 */
export function JobLog({ state }: { state: JobState | null }) {
  if (!state) return null;

  if (state.running) {
    const ultime = state.lines.slice(-4);
    return (
      <div className="flex flex-col gap-1 text-xs text-muted">
        {ultime.map((l, i) => (
          <p key={i} className={cx('truncate', i === ultime.length - 1 ? 'text-ink-soft' : '')}>
            {l}
          </p>
        ))}
        {ultime.length === 0 && <p>Avvio…</p>}
      </div>
    );
  }

  if (state.outcome === 'ok') {
    return (
      <Alert tone="ok" title="Fatto">
        {state.message}
      </Alert>
    );
  }
  if (state.outcome === 'error') {
    return (
      <Alert tone="danger" title="Non riuscito">
        {state.message}
      </Alert>
    );
  }
  return null;
}
