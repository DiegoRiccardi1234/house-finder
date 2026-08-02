import { useUpdate, type UpdatePhase } from '../hooks';
import type { UpdateProgress, UpdateStep } from '../types';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Kicker } from '../ui/Kicker';
import { cx } from '../ui/cx';

/**
 * Il pannello "Aggiornamenti": versione installata, controllo, e il pulsante che fa tutto.
 *
 * I quattro passi non sono decorazione. In Job e Trip Finder ogni difetto dell'aggiornamento si
 * presentava allo stesso modo — "funziona ma non finisce" — e senza sapere *dove* si era fermato
 * non c'era modo di distinguere un download lento da un file che l'antivirus teneva bloccato.
 */

const PASSI: Array<{ id: UpdateStep; label: string }> = [
  { id: 'download', label: 'Scarico' },
  { id: 'verify', label: 'Verifico' },
  { id: 'replace', label: 'Sostituisco' },
  { id: 'restart', label: 'Riavvio' },
];

const ORDINE: UpdateStep[] = ['idle', 'download', 'verify', 'replace', 'restart', 'done'];

function Passi({ progress }: { progress: UpdateProgress | null }) {
  const corrente = progress?.step ?? 'idle';
  const iCorrente = ORDINE.indexOf(corrente === 'error' ? 'idle' : corrente);
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {PASSI.map((p) => {
        const i = ORDINE.indexOf(p.id);
        const fatto = corrente === 'done' || i < iCorrente;
        const attivo = i === iCorrente;
        return (
          <li key={p.id}>
            <Badge mono tone={fatto ? 'ok' : attivo ? 'accent' : 'neutral'}>
              {fatto ? '✓ ' : ''}
              {p.label}
            </Badge>
          </li>
        );
      })}
    </ol>
  );
}

function Barra({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div
        className="h-full bg-accent transition-[width] duration-300"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function tonoFase(phase: UpdatePhase): 'warn' | 'danger' {
  return phase === 'timeout' ? 'warn' : 'danger';
}

export function UpdatePanel() {
  const { info, progress, phase, message, check, start, unlock } = useUpdate();

  if (!info) return <p className="text-sm text-muted">Controllo aggiornamenti…</p>;

  const inCorso = phase === 'running';

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker as="div">versione installata</Kicker>
          <p className="font-mono text-lg text-ink">{info.current}</p>
        </div>
        <div className="flex items-center gap-2">
          {info.updateAvailable && <Badge tone="warn">disponibile la {info.latest}</Badge>}
          {!info.updateAvailable && info.checked && !info.detail && (
            <Badge tone="ok">sei aggiornato</Badge>
          )}
          <Button size="sm" variant="ghost" onClick={() => check(true)} disabled={inCorso}>
            Controlla ora
          </Button>
        </div>
      </div>

      {/* "Non ho potuto controllare" e "sei aggiornato" sono due cose diverse: dirle uguali
          significa promettere aggiornamenti che non arriveranno mai. */}
      {!info.checked && (
        <p className="text-xs text-faint">
          GitHub non ha risposto: non so se ci sia una versione nuova. Riprova più tardi.
        </p>
      )}

      {info.detail && !info.updateAvailable && (
        <Alert tone="info" title="C'è una versione nuova, ma non da qui">
          {info.detail}
        </Alert>
      )}

      {info.updateAvailable && !inCorso && phase !== 'error' && phase !== 'timeout' && (
        <div className="flex flex-col gap-3">
          {info.notes && (
            <details className="text-sm text-muted">
              <summary className="cursor-pointer">
                <Kicker>novità della {info.latest}</Kicker>
              </summary>
              <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs">
                {info.notes}
              </pre>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="primary" onClick={() => void start()}>
              Aggiorna ora
            </Button>
            {info.releaseUrl && (
              <a
                href={info.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                Vedi la release ↗
              </a>
            )}
          </div>
          <p className="text-xs text-faint">
            Il programma si chiude, si sostituisce e si riapre da solo. L'archivio, le key e la tua
            configurazione non vengono toccati.
          </p>
        </div>
      )}

      {inCorso && (
        <div className="flex flex-col gap-2">
          <Passi progress={progress} />
          <Barra pct={progress?.pct ?? 0} />
          <p className={cx('text-xs', 'text-muted')}>
            {progress?.detail ?? 'Lavoro in corso…'}
            {progress?.step === 'restart' && ' — la pagina si ricarica da sola quando torna su.'}
          </p>
        </div>
      )}

      {(phase === 'error' || phase === 'timeout') && (
        <Alert tone={tonoFase(phase)} title="Aggiornamento non riuscito">
          <p>{message}</p>
          <p className="mt-2 text-xs">
            Il diario completo è in <code>state\logs\updater.log</code>. Se il file bloccato è
            nominato lì, di solito è l'antivirus: riprova fra un minuto.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void unlock()}>
              Sblocca e riprova
            </Button>
            {info.releaseUrl && (
              <a
                href={info.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="self-center text-xs text-accent hover:underline"
              >
                Scarica a mano ↗
              </a>
            )}
          </div>
        </Alert>
      )}
    </Card>
  );
}
