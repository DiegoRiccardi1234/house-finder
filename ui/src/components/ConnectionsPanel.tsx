import { useCallback, useEffect, useState } from 'react';
import { agentJson, TASK_LABELS, type AiTask, type Connections, type Connection } from '../agent-api';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Field, Input, Select } from '../ui/Field';
import { AiProvidersPanel } from './AiProvidersPanel';
import { ModelPicker } from './ModelPicker';

/**
 * L'AI dell'app, in una pagina sola.
 *
 * Prima erano cinque schede dentro la scheda «Connessioni AI»: connessioni, task, diagnostica,
 * MCP e provider. Per sapere se una connessione funzionava bisognava cambiare scheda e premere
 * «Diagnostica»; per sapere a cosa serviva, un'altra scheda ancora. Ora:
 *  1. in cima, cosa usa l'AI per ogni funzione, con lo stato accanto;
 *  2. sotto, le connessioni, ognuna con lo stato già controllato (gratis: nessuna inferenza);
 *  3. le chiavi API storiche sotto «Avanzate». Il collegamento MCP è andato in App.
 */

const PROVIDERS = ['openrouter', 'cerebras', 'groq', 'openai', 'google', 'deepseek', 'xai', 'glm', 'mistral', 'anthropic', 'custom'];
const KIND_LABEL: Record<Connection['kind'], string> = { codex: 'Codex (account locale)', claude: 'Claude Code (account locale)', api: 'Chiave API / endpoint' };

interface Diagnostic { installed: boolean; authenticated: boolean | null; ready: boolean; detail?: string; models: { id: string }[] }
type Health = { state: 'checking' } | { state: 'done'; d: Diagnostic } | { state: 'error'; message: string };

function StatusBadge({ conn, health }: { conn: Connection; health?: Health }) {
  if (!conn.enabled) return <Badge tone="neutral">spenta</Badge>;
  if (!health || health.state === 'checking') return <Badge tone="neutral">controllo…</Badge>;
  if (health.state === 'error') return <Badge tone="warn">non verificata</Badge>;
  return health.d.ready ? <Badge tone="ok">pronta</Badge> : <Badge tone="danger">non disponibile</Badge>;
}

function healthText(h?: Health): string {
  if (!h || h.state === 'checking') return '';
  if (h.state === 'error') return h.message;
  const d = h.d;
  if (d.ready) return d.models.length ? `Modelli: ${d.models.slice(0, 6).map((m) => m.id).join(', ')}${d.models.length > 6 ? '…' : ''}` : 'Pronta.';
  if (!d.installed) return 'Il programma non è installato su questo computer.';
  if (d.authenticated === false) return 'Account non collegato o abbonamento non attivo.';
  return d.detail ?? 'Non pronta.';
}

export function ConnectionsPanel({ onChanged }: { onChanged?: () => void }) {
  const [config, setConfig] = useState<Connections | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [test, setTest] = useState<Record<string, string>>({});
  /** La connessione appena aggiunta si apre da sola: altrimenti i suoi campi restano chiusi. */
  const [nuova, setNuova] = useState<string | null>(null);

  const diagnose = useCallback(async (list: Connection[]) => {
    setHealth(Object.fromEntries(list.map((c) => [c.id, { state: 'checking' } as Health])));
    await Promise.all(list.filter((c) => c.enabled).map(async (c) => {
      try {
        const d = await agentJson<Diagnostic>(`/api/ai/connections/${c.id}/diagnostics`);
        setHealth((h) => ({ ...h, [c.id]: { state: 'done', d } }));
      } catch (e) {
        setHealth((h) => ({ ...h, [c.id]: { state: 'error', message: (e as Error).message } }));
      }
    }));
  }, []);

  useEffect(() => {
    let active = true;
    agentJson<Connections>('/api/ai/connections')
      .then((value) => { if (!active) return; setConfig(value); void diagnose(value.connections); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [diagnose]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const update = (id: string, patch: Partial<Connection>) => {
    if (patch.kind && patch.kind !== 'api') setSecrets((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
    setConfig((c) => c && ({ ...c, connections: c.connections.map((row) => (row.id === id ? { ...row, ...patch } : row)) }));
    setDirty(true);
  };
  const save = () => act(async () => {
    if (!config) return;
    const body = { ...config, connections: config.connections.map(({ hasKey: _hasKey, ...row }) => row), secrets };
    await agentJson('/api/ai/connections', 'PUT', body);
    const fresh = await agentJson<Connections>('/api/ai/connections');
    setConfig(fresh); setSecrets({}); setDirty(false);
    setMessage('Salvato.'); onChanged?.();
    void diagnose(fresh.connections);
  });
  const route = (task: AiTask, id: string) => {
    if (!config) return;
    const tasks = { ...config.tasks };
    if (!id) delete tasks[task]; else tasks[task] = { connectionId: id, fallbackIds: [] };
    setConfig({ ...config, tasks }); setDirty(true);
  };

  if (error && !config) return <Alert tone="danger" title="Non riesco a leggere le connessioni">{error}</Alert>;
  if (!config) return <p aria-busy="true" className="text-sm text-muted">Carico le connessioni…</p>;

  const byId = (id?: string) => config.connections.find((c) => c.id === id);

  // Riepilogo in una riga: quale connessione fa cosa, raggruppando le funzioni che ne usano una sola.
  const summary = new Map<string, string[]>();
  for (const task of Object.keys(TASK_LABELS) as AiTask[]) {
    const conn = byId(config.tasks[task]?.connectionId);
    const who = conn ? `${conn.label}${conn.model ? ` (${conn.model})` : ''}` : 'configurazione precedente';
    summary.set(who, [...(summary.get(who) ?? []), TASK_LABELS[task].toLowerCase()]);
  }

  return (
    <section className="flex flex-col gap-4 pb-20" aria-label="Intelligenza artificiale">
      {error && <Alert tone="danger" title="Operazione non completata">{error}</Alert>}

      <p className="text-sm text-ink-soft" aria-label="Riepilogo dell'AI">
        {[...summary].map(([who, tasks], i) => (
          <span key={who}>
            {i > 0 && <span className="text-faint"> · </span>}
            <span className="first-letter:uppercase inline-block">{tasks.join(', ')}</span>: <b className="font-medium text-ink">{who}</b>
          </span>
        ))}
      </p>

      <Card>
        <CardHeader title="Per cosa usi l'AI" />
        <div className="flex flex-col gap-1 p-4">
          <p className="mb-2 max-w-[72ch] text-sm text-muted">
            Ogni funzione usa la connessione scelta qui. «Configurazione precedente» vuol dire le chiavi API sotto «Avanzate».
          </p>
          {(Object.keys(TASK_LABELS) as AiTask[]).map((task) => {
            const routeOf = config.tasks[task];
            const conn = byId(routeOf?.connectionId);
            const usable = config.connections.filter((c) => c.enabled && (task !== 'vision' || c.vision));
            return (
              <div key={task} className="grid grid-cols-1 items-center gap-2 border-b border-hair py-2 last:border-0 sm:grid-cols-[12rem_minmax(14rem,22rem)_auto]">
                <span className="text-sm text-ink">{TASK_LABELS[task]}</span>
                <Select aria-label={`Connessione per ${TASK_LABELS[task]}`} value={routeOf?.connectionId ?? ''} onChange={(e) => route(task, e.target.value)}>
                  <option value="">Configurazione precedente (chiavi API)</option>
                  {usable.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
                <span>{conn ? <StatusBadge conn={conn} health={health[conn.id]} /> : null}</span>
                {routeOf && usable.length > 1 && (
                  <details className="text-xs text-muted sm:col-span-3">
                    <summary className="cursor-pointer">Se non risponde, prova anche…</summary>
                    <div className="mt-2 flex flex-wrap gap-4">
                      {usable.filter((c) => c.id !== routeOf.connectionId).map((c) => (
                        <label key={c.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={routeOf.fallbackIds.includes(c.id)}
                            onChange={(e) => {
                              setConfig({ ...config, tasks: { ...config.tasks, [task]: { ...routeOf, fallbackIds: e.target.checked ? [...routeOf.fallbackIds, c.id] : routeOf.fallbackIds.filter((x) => x !== c.id) } } });
                              setDirty(true);
                            }}
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Connessioni"
          action={
            <Button size="sm" disabled={busy} onClick={() => { const id = `connection_${crypto.randomUUID().slice(0, 8)}`; setNuova(id); setConfig({ ...config, connections: [...config.connections, { id, label: 'Claude personale', kind: 'claude', vision: false, enabled: true }] }); setDirty(true); }}>
              Aggiungi una connessione
            </Button>
          }
        />
        <div className="flex flex-col divide-y divide-hair">
          {config.connections.length === 0 && <p className="p-4 text-sm text-muted">Nessuna connessione: si usano le chiavi API sotto «Avanzate».</p>}
          {config.connections.map((row) => (
            <details key={row.id} className="group px-4 py-3" open={row.id === nuova ? true : undefined}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                <span className="text-base text-ink">{row.label}</span>
                <span className="text-sm text-muted">{KIND_LABEL[row.kind]}{row.model ? ` · ${row.model}` : ''}</span>
                <StatusBadge conn={row} health={health[row.id]} />
                <span className="ml-auto text-xs text-muted group-open:hidden">Modifica</span>
              </summary>
              <p className="mt-1 text-xs text-muted">{row.enabled ? healthText(health[row.id]) : 'Spenta: nessuna funzione la usa.'}</p>
              <fieldset disabled={busy} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Nome">{(p) => <Input {...p} value={row.label} maxLength={100} onChange={(e) => update(row.id, { label: e.target.value })} />}</Field>
                <Field label="Tipo">
                  {(p) => (
                    <Select {...p} value={row.kind} onChange={(e) => update(row.id, { kind: e.target.value as Connection['kind'], vision: e.target.value === 'codex', ...(e.target.value === 'api' ? { provider: 'custom' } : {}) })}>
                      <option value="claude">Claude Code (account locale)</option>
                      <option value="codex">Codex (account locale)</option>
                      <option value="api">Chiave API / endpoint compatibile</option>
                    </Select>
                  )}
                </Field>
                <Field label="Modello" hint="Vuoto: il modello predefinito del programma.">{(p) => <Input {...p} value={row.model ?? ''} onChange={(e) => update(row.id, { model: e.target.value })} />}</Field>
                {row.kind === 'codex' && (
                  <Field label="Ragionamento">
                    {(p) => <Select {...p} value={row.reasoning ?? 'high'} onChange={(e) => update(row.id, { reasoning: e.target.value as Connection['reasoning'] })}>{['minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => <option key={level}>{level}</option>)}</Select>}
                  </Field>
                )}
                {row.kind === 'api' && (
                  <>
                    <Field label="Provider">{(p) => <Select {...p} value={row.provider ?? 'custom'} onChange={(e) => update(row.id, { provider: e.target.value })}>{PROVIDERS.map((id) => <option key={id}>{id}</option>)}</Select>}</Field>
                    <Field label="Indirizzo dell'endpoint">{(p) => <Input {...p} type="url" value={row.baseUrl ?? ''} placeholder="http://127.0.0.1:8000/v1" onChange={(e) => update(row.id, { baseUrl: e.target.value || undefined })} />}</Field>
                    <Field label="Nuova chiave" hint={row.hasKey ? 'Chiave salvata: lascia vuoto per tenerla.' : 'Facoltativa per endpoint locali.'}>
                      {(p) => <Input {...p} type="password" autoComplete="new-password" value={secrets[row.id] ?? ''} onChange={(e) => { const value = e.target.value; setSecrets((prev) => { const next = { ...prev }; if (value) next[row.id] = value; else delete next[row.id]; return next; }); setDirty(true); }} />}
                    </Field>
                  </>
                )}
              </fieldset>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={row.enabled} onChange={(e) => update(row.id, { enabled: e.target.checked })} /> Accesa</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={row.vision} disabled={row.kind === 'claude'} onChange={(e) => update(row.id, { vision: e.target.checked })} /> Legge le foto</label>
                <Button size="sm" variant="secondary" disabled={busy || dirty || !row.enabled} title={dirty ? 'Salva prima di provare.' : 'Una domanda di prova: usa un po\' di quota.'} onClick={() => act(async () => { const d = await agentJson<{ ok: boolean; text?: string; detail?: string }>(`/api/ai/connections/${row.id}/test`, 'POST', {}); setTest((t) => ({ ...t, [row.id]: d.ok ? `Prova riuscita: ${d.text ?? 'risposta valida'}` : d.detail ?? 'Prova non riuscita' })); })}>
                  Prova con una domanda
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setSecrets((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== row.id))); setConfig({ ...config, connections: config.connections.filter((c) => c.id !== row.id), tasks: Object.fromEntries(Object.entries(config.tasks).filter(([, r]) => r.connectionId !== row.id).map(([task, r]) => [task, { ...r, fallbackIds: r.fallbackIds.filter((id) => id !== row.id) }])) }); setDirty(true); }}>Rimuovi</Button>
                {row.kind === 'api' && row.hasKey && <Button size="sm" variant="ghost" onClick={() => { setSecrets({ ...secrets, [row.id]: '' }); setDirty(true); setMessage('La chiave verrà rimossa al salvataggio.'); }}>Rimuovi la chiave</Button>}
              </div>
              {test[row.id] && <p role="status" className="mt-2 break-words text-sm">{test[row.id]}</p>}
            </details>
          ))}
        </div>
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer px-4 py-3 text-lg text-ink" style={{ fontFamily: 'var(--font-display)' }}>Avanzate: chiavi API e modelli</summary>
          <div className="flex flex-col gap-4 border-t border-hair p-4">
            <p className="max-w-[72ch] text-sm text-muted">La configurazione precedente, usata dalle funzioni a cui sopra non hai assegnato una connessione.</p>
            <AiProvidersPanel onChanged={onChanged} />
            <ModelPicker onChanged={onChanged} />
          </div>
        </details>
      </Card>

      <div className="sticky bottom-2 z-[1100] flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[0_6px_18px_rgba(20,24,26,0.08)]">
        <Button variant="primary" loading={busy} disabled={!dirty && Object.keys(secrets).length === 0} onClick={save}>Salva le connessioni</Button>
        <span role="status" className="text-sm text-muted">{message || (dirty ? 'Modifiche non salvate.' : 'Tutto salvato.')}</span>
      </div>
    </section>
  );
}
