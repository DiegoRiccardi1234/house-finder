import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useJob } from '../hooks';
import type { FbSession } from '../types';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Kicker } from '../ui/Kicker';
import { JobLog } from './JobLog';

/**
 * L'accesso a Facebook, senza terminale.
 *
 * Era l'unico pezzo dell'app che dal pacchetto scaricabile **non si poteva proprio fare**: il
 * comando esisteva (`fb:from-brave`) ma lì dentro non c'è npm, quindi non c'era modo di lanciarlo.
 *
 * La via scelta apre un browser vero e lascia accedere a mano. Il codice a due fattori non è un
 * ostacolo — anzi, è il motivo per cui questa strada batte la scorciatoia che riusava la sessione
 * di Brave: il codice non deve indovinarlo l'app, lo digita la persona nella finestra aperta. E
 * funziona per chiunque, non solo per chi ha quel browser con l'account già dentro.
 */
export function FacebookSession({ onChanged }: { onChanged?: () => void }) {
  const [session, setSession] = useState<FbSession | null>(null);
  const { state, busy, start } = useJob('fb-login');

  const reload = useCallback(() => {
    api
      .fbSession()
      .then(setSession)
      .catch(() => {});
  }, []);

  useEffect(reload, [reload]);
  // A lavoro finito la sessione sul disco è cambiata: senza questo la card resta indietro.
  useEffect(() => {
    if (state && !state.running && state.outcome) {
      reload();
      onChanged?.();
    }
  }, [state?.finishedAt, state?.outcome]);

  const scadenza = session?.expiresAt ? new Date(session.expiresAt) : null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker as="div">sessione facebook</Kicker>
          {session?.exists ? (
            <p className="text-sm text-ink">
              Collegato{session.accountId ? <> · account <code>{session.accountId}</code></> : null}
            </p>
          ) : (
            <p className="text-sm text-muted">Nessuna sessione: il canale Facebook resta spento.</p>
          )}
        </div>
        <Badge tone={session?.exists ? 'ok' : 'neutral'}>
          {session?.exists ? 'collegato' : 'non collegato'}
        </Badge>
      </div>

      {scadenza && (
        <p className="text-xs text-faint">
          I cookie salvati valgono fino al {scadenza.toLocaleDateString('it-IT')}. È solo la
          scadenza dichiarata: se Facebook chiude la sessione prima, te ne accorgi da una scansione
          che non trova niente — in quel caso rifai l'accesso.
        </p>
      )}

      {busy && (
        <Alert tone="info" title="Accedi nella finestra che si è aperta">
          Cercala nella barra delle applicazioni. Se hai il codice a due fattori, inseriscilo lì:
          appena sei dentro, la sessione viene salvata da sola.
        </Alert>
      )}

      <JobLog state={state} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          onClick={() => void start(() => api.fbLogin())}
        >
          {session?.exists ? 'Rifai l\'accesso' : 'Accedi a Facebook'}
        </Button>
        {session?.exists && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void api.fbForget().then(() => {
                reload();
                onChanged?.();
              });
            }}
          >
            Dimentica la sessione
          </Button>
        )}
      </div>

      <p className="text-xs text-faint">
        I cookie restano su questo computer, in <code>state/fb-state.json</code>: non vengono
        versionati né inclusi nel pacchetto di aggiornamento.
      </p>
    </Card>
  );
}
