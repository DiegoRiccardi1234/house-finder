import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { MailConfig } from '../types';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, Input } from '../ui/Field';
import { cx } from '../ui/cx';

/**
 * Le credenziali della posta, nella UI.
 *
 * Le key AI si incollavano qui dentro; la password della casella no, quella stava nel `.env` — un
 * file di testo da aprire col blocco note, che dal pacchetto scaricabile è esattamente la stessa
 * barriera di un comando da digitare, solo travestita meglio.
 *
 * Stessa regola delle key AI: **la password non torna mai indietro dal server**. Il campo resta
 * vuoto anche quando è configurata, e lasciarlo vuoto significa "non l'ho toccata" — non
 * "cancellala", altrimenti cambiare la cartella la butterebbe via.
 */
export function MailPanel({ onChanged }: { onChanged?: () => void }) {
  const [cfg, setCfg] = useState<MailConfig | null>(null);
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);

  const reload = useCallback(() => {
    api
      .getMail()
      .then((c) => {
        setCfg(c);
        setHost(c.host);
        setUser(c.user);
        setFolder(c.folder);
        setPass('');
      })
      .catch((e: Error) => setMsg({ tone: 'danger', text: e.message }));
  }, []);

  useEffect(reload, [reload]);

  async function salva(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const next = await api.putMail({ host, user, folder, ...(pass ? { pass } : {}) });
      setCfg(next);
      setPass('');
      onChanged?.();
      // Salvare e basta non dice se la password è giusta: si prova subito, come per le key AI —
      // dove è la lista modelli che arriva a fare da verifica.
      const t = await api.testMail();
      setMsg(
        t.ok
          ? { tone: 'ok', text: `Connessione riuscita: ${t.messages ?? 0} messaggi in ${t.folder}.` }
          : { tone: 'warn', text: `Salvato, ma la connessione non riesce: ${t.error}` },
      );
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <p className="text-sm text-muted">Carico le impostazioni della posta…</p>;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base text-ink">Casella email</h3>
          <p className="text-xs text-muted">
            Da qui arrivano gli avvisi delle ricerche salvate sui portali. Serve un account IMAP:
            quello dedicato agli annunci, non la tua posta di tutti i giorni.
          </p>
        </div>
        <Badge tone={cfg.configured ? 'ok' : 'neutral'}>
          {cfg.configured ? 'configurata' : 'non configurata'}
        </Badge>
      </div>

      {cfg.fromEnv && (
        <Alert tone="info" title="La password arriva dal file .env">
          Per questo il campo qui sotto è vuoto. Se ne scrivi una nuova, vince quella.
        </Alert>
      )}

      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void salva();
        }}
      >
        <Field label="Server IMAP" hint={`predefinito: ${cfg.defaults.host}`}>
          {(a) => <Input {...a} value={host} onChange={(e) => setHost(e.target.value)} />}
        </Field>
        <Field label="Cartella" hint={`predefinita: ${cfg.defaults.folder}`}>
          {(a) => <Input {...a} value={folder} onChange={(e) => setFolder(e.target.value)} />}
        </Field>
        <Field label="Indirizzo">
          {(a) => (
            <Input
              {...a}
              value={user}
              autoComplete="username"
              placeholder="nome@esempio.it"
              onChange={(e) => setUser(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={cfg.configured ? 'Configurata. Lascia vuoto per non cambiarla.' : undefined}
        >
          {(a) => (
            <Input
              {...a}
              type="password"
              value={pass}
              autoComplete="off"
              placeholder={cfg.configured ? '••••••••' : '—'}
              onChange={(e) => setPass(e.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Button size="sm" variant="primary" type="submit" loading={busy}>
            Salva e prova la connessione
          </Button>
          {cfg.configured && (
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void api.forgetMail().then((c) => {
                  setCfg(c);
                  setPass('');
                  setMsg({ tone: 'ok', text: 'Credenziali rimosse.' });
                  onChanged?.();
                });
              }}
            >
              Rimuovi
            </Button>
          )}
        </div>
      </form>

      {msg && (
        <p
          className={cx(
            'text-xs',
            msg.tone === 'ok' ? 'text-ok' : msg.tone === 'warn' ? 'text-warn' : 'text-danger',
          )}
        >
          {msg.text}
        </p>
      )}

      <p className="text-xs text-faint">
        Salvate in <code>data/local/mail.json</code>, che non viene versionato né incluso nel
        pacchetto di release. Il server non rimanda mai la password al browser.
      </p>
    </Card>
  );
}
