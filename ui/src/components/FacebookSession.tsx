import { useCallback, useEffect, useState } from 'react';
import { api, type FbSessionDetails } from '../api';
import { useJob } from '../hooks';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Field, Select } from '../ui/Field';
import { Kicker } from '../ui/Kicker';
import { JobLog } from './JobLog';

/**
 * L'accesso a Facebook, senza terminale e per chiunque.
 *
 * Due strade, in parole semplici. "Accedi da qui" apre una finestra con un profilo che resta su
 * questo computer: la prima volta Facebook può chiedere una verifica, poi si ricorda del
 * dispositivo. "Prendi la sessione da un browser" copia l'accesso da Brave, Edge, Vivaldi, Opera
 * o Firefox, se lì si è già dentro. Chrome si mostra ma non si può usare: è Chrome a impedirlo.
 *
 * I dettagli tecnici (file, cookie) stanno sotto "Dettagli": a chi vuole solo collegarsi non
 * servono, e messi in primo piano spaventano più di quanto spieghino.
 */
export function FacebookSession({ onChanged }: { onChanged?: () => void }) {
  const [session, setSession] = useState<FbSessionDetails | null>(null);
  const [scelto, setScelto] = useState<string>('');
  const [azione, setAzione] = useState<'login' | 'import' | null>(null);
  const [confermaTutto, setConfermaTutto] = useState(false);
  const [cancellando, setCancellando] = useState(false);
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

  // Server di prima della 1.9: niente elenco, ma Brave sì se c'era.
  const browsers =
    session?.browsers ??
    (session?.braveAvailable ? [{ id: 'brave', label: 'Brave', available: true, importable: true }] : []);
  const importabili = browsers.filter((b) => b.available && b.importable);
  const chrome = browsers.find((b) => b.id === 'chrome' && b.available && !b.importable);

  // Il primo browser utilizzabile è già scelto: un menu vuoto da aprire è un passo in più per niente.
  useEffect(() => {
    if (!importabili.some((b) => b.id === scelto)) setScelto(importabili[0]?.id ?? '');
  }, [importabili.map((b) => b.id).join(',')]);

  const sceltoInfo = importabili.find((b) => b.id === scelto);
  const scadenza = session?.expiresAt ? new Date(session.expiresAt) : null;
  const collegato = !!session?.exists;

  const dimentica = (all: boolean) => {
    setCancellando(true);
    void api
      .fbForget(all)
      .catch(() => {})
      .finally(() => {
        setCancellando(false);
        setConfermaTutto(false);
        reload();
        onChanged?.();
      });
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Kicker as="div">account facebook</Kicker>
          {collegato ? (
            <p className="text-sm text-ink">
              Collegato
              {session?.accountId && (
                <span className="ml-1 text-xs text-faint">· account {session.accountId}</span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted">
              Non collegato: finché non accedi, l'app non legge i gruppi né il Marketplace.
            </p>
          )}
          {collegato && scadenza && (
            <p className="text-xs text-faint">
              Valido fino al {scadenza.toLocaleDateString('it-IT')}, salvo che Facebook lo chiuda prima.
            </p>
          )}
        </div>
        <Badge tone={collegato ? 'ok' : 'neutral'}>{collegato ? 'collegato' : 'non collegato'}</Badge>
      </div>

      {busy && (
        <Alert
          tone="info"
          title={azione === 'import' ? 'Sto copiando l\'accesso…' : 'Accedi nella finestra che si è aperta'}
        >
          {azione === 'import'
            ? 'Ci vuole qualche secondo. Il browser da cui copi deve restare chiuso.'
            : 'Cercala nella barra delle applicazioni. Se Facebook ti chiede un codice o una conferma, fallo lì: appena sei dentro, l\'app si collega da sola.'}
        </Alert>
      )}

      <JobLog state={state} />

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            loading={busy && azione !== 'import'}
            disabled={busy}
            onClick={() => {
              setAzione('login');
              void start(() => api.fbLogin());
            }}
          >
            {collegato ? 'Accedi di nuovo da qui' : 'Accedi da qui'}
          </Button>
        </div>
        <p className="max-w-[72ch] text-xs text-muted">
          Si apre una finestra: la prima volta Facebook può chiederti una verifica, poi si ricorda di
          questo computer.
          {session?.profileReady ? ' Questo computer è già stato riconosciuto.' : ''}
        </p>
      </div>

      {importabili.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-hair pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label="Prendi la sessione da un browser"
              hint="Se in quel browser sei già dentro Facebook, l'accesso si copia senza password. Prima chiudilo del tutto."
              className="min-w-[14rem] flex-1"
            >
              {(a) => (
                <Select {...a} value={scelto} disabled={busy} onChange={(e) => setScelto(e.target.value)}>
                  {importabili.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !scelto}
              loading={busy && azione === 'import'}
              onClick={() => {
                setAzione('import');
                void start(() => api.fbImport(scelto));
              }}
            >
              Prendi da {sceltoInfo?.label ?? 'browser'}
            </Button>
          </div>
          {sceltoInfo?.note && <p className="text-xs text-muted">{sceltoInfo.note}</p>}
        </div>
      )}

      {chrome && (
        <p className="max-w-[72ch] text-xs text-muted">
          Usi Chrome? Da lì l'app non può copiare l'accesso: è Chrome a impedirlo. Usa "Accedi da
          qui": la verifica di Facebook si fa una volta sola.
        </p>
      )}

      {collegato && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={busy || cancellando} onClick={() => dimentica(false)}>
            Dimentica la sessione
          </Button>
        </div>
      )}

      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Dettagli</summary>
        <div className="mt-2 flex max-w-[72ch] flex-col gap-2">
          <p>
            La sessione (i cookie di Facebook, nient'altro) resta su questo computer in{' '}
            <code>state/fb-state.json</code>: non viene versionata né inclusa nel pacchetto di
            aggiornamento. La finestra di "Accedi da qui" usa un profilo suo, in{' '}
            <code>state/fb-browser-profile/</code>, che le scansioni riusano.
          </p>
          <p>
            "Dimentica la sessione" toglie l'accesso ma tiene il profilo, così il prossimo accesso
            non richiede una nuova verifica. Per cambiare account o ripartire da zero cancella
            anche il profilo.
          </p>
          {browsers.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {browsers.map((b) => (
                <li key={b.id}>
                  {b.label}: {!b.available ? 'non trovato' : b.importable ? 'trovato' : 'trovato, non utilizzabile'}
                </li>
              ))}
            </ul>
          )}
          {session?.profileReady && (
            <div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || cancellando}
                onClick={() => setConfermaTutto(true)}
              >
                Cancella anche il profilo del browser dell'app
              </Button>
            </div>
          )}
        </div>
      </details>

      <ConfirmDialog
        open={confermaTutto}
        title="Cancellare anche il profilo?"
        confirmLabel="Cancella tutto"
        busy={cancellando}
        onConfirm={() => dimentica(true)}
        onCancel={() => setConfermaTutto(false)}
      >
        L'app si scollega e Facebook non riconoscerà più questo computer: al prossimo accesso potrà
        chiederti di nuovo una verifica.
      </ConfirmDialog>
    </Card>
  );
}
