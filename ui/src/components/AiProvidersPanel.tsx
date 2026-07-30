import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ProviderInfo, ProvidersState } from '../types';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, Input } from '../ui/Field';
import { Kicker } from '../ui/Kicker';
import { cx } from '../ui/cx';

const STATE_STYLE: Record<string, string> = {
  active: 'border-accent ring-1 ring-accent/30',
  configured: 'border-line',
  invalid: 'border-warn',
  empty: 'border-hair opacity-90',
};

function stateOf(p: ProviderInfo): keyof typeof STATE_STYLE {
  if (p.keyState === 'invalid') return 'invalid';
  if (!p.configured) return 'empty';
  return p.isPrimary ? 'active' : 'configured';
}

export function AiProvidersPanel({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<ProvidersState | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api
      .aiProviders()
      .then((s) => {
        setState(s);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  if (error) {
    return (
      <Alert tone="danger" title="Non riesco a leggere i provider">
        {error}. Controlla che il server sia acceso.
      </Alert>
    );
  }
  if (!state) return <p className="text-sm text-muted">Carico i provider…</p>;

  const anyConfigured = state.providers.some((p) => p.configured);

  return (
    <div className="flex flex-col gap-4">
      {!anyConfigured && (
        <Alert tone="warn" title="Nessun provider AI configurato">
          Gli annunci vengono raccolti lo stesso, ma nessuno li valuta. I provider con il badge{' '}
          <b>gratis</b> qui sotto danno una key in un minuto e senza carta di credito.
        </Alert>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {state.providers.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            onSaved={() => {
              reload();
              onChanged?.();
            }}
          />
        ))}
      </div>

      <p className="text-xs text-faint">
        Le key sono salvate in <code>data/local/providers.json</code>, che non viene versionato né
        incluso nel pacchetto di release. Il server non le rimanda mai al browser: da qui in avanti
        vedrai solo se un provider è configurato, non il suo valore.
      </p>
    </div>
  );
}

function ProviderCard({ p, onSaved }: { p: ProviderInfo; onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(p.needsEndpoint ? p.baseUrl : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [models, setModels] = useState<string[] | null>(null);

  async function save(nextKey?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.saveProviderKey(p.id, {
        key: nextKey !== undefined ? nextKey : key,
        ...(p.needsEndpoint ? { baseUrl } : {}),
      });
      setKey(''); // il campo non ripropone mai il segreto
      if (r.keyState === 'invalid') {
        setMsg({ tone: 'warn', text: r.error ?? 'Key rifiutata dal provider.' });
      } else if (r.models) {
        setModels(r.models);
        setMsg({ tone: 'ok', text: `${r.models.length} modelli disponibili.` });
      } else if (!r.configured) {
        setMsg({ tone: 'ok', text: 'Key rimossa.' });
      } else if (r.error) {
        setMsg({ tone: 'warn', text: r.error });
      }
      onSaved();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary() {
    setBusy(true);
    try {
      await api.setPrimaryProvider({ provider: p.id });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const st = stateOf(p);

  return (
    <Card className={cx('flex flex-col gap-3 p-4', STATE_STYLE[st])}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base text-ink">{p.label}</h3>
          <p className="text-xs text-muted">{p.hint}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {p.free && <Badge mono tone="ok">gratis</Badge>}
          {p.isPrimary && <Badge mono tone="accent">in uso</Badge>}
          {p.keyState === 'invalid' && <Badge mono tone="warn">key rifiutata</Badge>}
        </div>
      </div>

      {p.needsEndpoint && (
        <Field label="Endpoint" hint="es. http://localhost:11434/v1">
          {(a) => (
            <Input
              {...a}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
            />
          )}
        </Field>
      )}

      {/* Il form serve davvero: dà l'invio con Enter e toglie l'avviso del browser
          sui campi password fuori da un form. */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field
          label={p.keyOptional ? 'API key (facoltativa)' : 'API key'}
          hint={p.configured ? 'Configurata. Incolla una nuova key per sostituirla.' : undefined}
        >
          {(a) => (
            <Input
              {...a}
              type="password"
              value={key}
              autoComplete="off"
              placeholder={p.configured ? '••••••••' : '—'}
              onChange={(e) => setKey(e.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" type="submit" loading={busy}>
            Salva e leggi i modelli
          </Button>
          {p.configured && !p.isPrimary && (
            <Button size="sm" type="button" onClick={makePrimary} disabled={busy}>
              Usa questo
            </Button>
          )}
          {p.configured && (
            <Button size="sm" type="button" variant="ghost" onClick={() => save('')} disabled={busy}>
              Rimuovi
            </Button>
          )}
          {!p.configured && (
            <a
              href={p.signup}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline"
            >
              Ottieni una key ↗
            </a>
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

      {models && models.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">
            <Kicker>modelli disponibili</Kicker>
          </summary>
          <ul className="mt-1 max-h-32 overflow-y-auto">
            {models.slice(0, 60).map((m) => (
              <li key={m} className="truncate font-mono text-[0.68rem]">
                {m}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
