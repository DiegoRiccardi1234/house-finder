import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ModelChoice, ModelsState, TaskModels } from '../types';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, Select } from '../ui/Field';

/**
 * La scelta del modello, per compito.
 *
 * Fino a ieri il motore sceglieva benissimo da solo ma non lo diceva a nessuno: il consigliato era
 * già calcolato lato server e buttato via dal client, e per fissare un modello bisognava passare da
 * una variabile d'ambiente. Qui la scelta torna dove serve, con la stessa regola che Trip Finder
 * dichiara apertamente: **lasciali su automatico e li sceglie lui; se ne scegli uno lo prova per
 * primo, ma se rifiuta prosegue sugli altri.**
 *
 * La voce "Automatico" dice sempre su chi ripiegherebbe, anche quando un modello è fissato — senza
 * quell'informazione "automatico" è una parola vuota.
 */
export function ModelPicker({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<ModelsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api
      .aiModels()
      .then((s) => {
        setState(s);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const pin = useCallback(
    async (task: 'reasoning' | 'vision', model: string) => {
      if (!state?.provider) return;
      setBusy(true);
      try {
        await api.setPrimaryProvider({
          provider: state.provider,
          // Stringa vuota = si torna in automatico: il server la tratta come "nessuna preferenza".
          ...(task === 'reasoning' ? { model } : { visionModel: model }),
        });
        reload();
        onChanged?.();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [state?.provider, reload, onChanged],
  );

  if (error) {
    return (
      <Alert tone="danger" title="Non riesco a leggere i modelli">
        {error}
      </Alert>
    );
  }
  if (!state) return <p className="text-sm text-muted">Carico i modelli…</p>;
  if (!state.configured) {
    return (
      <Alert tone="warn" title="Nessun provider AI configurato">
        Configura una key qui sotto: la scelta del modello compare quando c'è un provider da cui
        prenderli.
      </Alert>
    );
  }

  const tasks: Array<['reasoning' | 'vision', TaskModels | undefined]> = [
    ['reasoning', state.tasks.reasoning],
    ['vision', state.tasks.vision],
  ];

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="text-base text-ink">Modelli</h3>
        <p className="text-xs text-muted">
          Lasciali su <b>automatico</b> e li sceglie lui, in base a salute e taglia. Se ne fissi uno
          lo prova per primo; se rifiuta, il failover prosegue sugli altri.
          {state.publishesHealth === false && (
            <>
              {' '}
              <span className="text-faint">
                Questo provider non pubblica la salute dei modelli: l'ordine segue la preferenza del
                catalogo e le penalità accumulate sul campo.
              </span>
            </>
          )}
        </p>
      </div>

      {tasks.map(([id, t]) =>
        t && t.candidates.length > 0 ? (
          <TaskRow key={id} task={id} models={t} busy={busy} onPin={(m) => void pin(id, m)} />
        ) : null,
      )}

      <div>
        <Button size="sm" variant="ghost" onClick={reload} disabled={busy}>
          Ricontrolla
        </Button>
      </div>
    </Card>
  );
}

function etichetta(c: ModelChoice): string {
  const parti: string[] = [c.id];
  if (c.uptime5m != null) parti.push(`${c.uptime5m.toFixed(1)}%`);
  if (c.penalty > 0) parti.push('penalizzato');
  return parti.join('  ·  ');
}

function TaskRow({
  task,
  models,
  busy,
  onPin,
}: {
  task: 'reasoning' | 'vision';
  models: TaskModels;
  busy: boolean;
  onPin: (model: string) => void;
}) {
  const consigliati = models.candidates.filter((c) => c.recommended);
  const gratuiti = models.candidates.filter((c) => !c.recommended && c.free);
  const pagamento = models.candidates.filter((c) => !c.recommended && !c.free);
  const attivo = models.pinned ?? models.auto;

  return (
    <div className="flex flex-col gap-1">
      <Field
        label={models.label}
        hint={
          models.pinned
            ? `Fissato a mano. Senza la tua scelta userebbe ${models.auto ?? '—'}.`
            : undefined
        }
      >
        {(a) => (
          <Select
            {...a}
            value={models.pinned ?? ''}
            disabled={busy}
            onChange={(e) => onPin(e.target.value)}
          >
            {/* Dire su cosa ripiega è ciò che rende "Automatico" un'informazione e non un'etichetta. */}
            <option value="">
              {models.auto ? `Automatico — adesso ${models.auto}` : 'Automatico'}
            </option>
            {consigliati.length > 0 && (
              <optgroup label="Consigliati per questo compito">
                {consigliati.map((c) => (
                  <option key={c.id} value={c.id}>
                    {etichetta(c)}
                  </option>
                ))}
              </optgroup>
            )}
            {gratuiti.length > 0 && (
              <optgroup label="Altri gratuiti">
                {gratuiti.map((c) => (
                  <option key={c.id} value={c.id}>
                    {etichetta(c)}
                  </option>
                ))}
              </optgroup>
            )}
            {pagamento.length > 0 && (
              <optgroup label={`A pagamento (${pagamento.length})`}>
                {pagamento.map((c) => (
                  <option key={c.id} value={c.id}>
                    {etichetta(c)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        )}
      </Field>
      {attivo && (
        <p className="flex items-center gap-2 text-xs text-faint">
          <Badge mono tone={models.pinned ? 'accent' : 'neutral'}>
            {models.pinned ? 'fissato' : 'automatico'}
          </Badge>
          <span className="truncate font-mono text-[0.68rem]">{attivo}</span>
          {task === 'vision' && <span>usato per leggere le foto degli annunci</span>}
        </p>
      )}
    </div>
  );
}
