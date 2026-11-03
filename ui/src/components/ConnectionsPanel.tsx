import { useEffect, useState } from 'react';
import { agentJson, TASK_LABELS, type AiTask, type Connections, type Connection, type Proposal } from '../agent-api';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { Tabs } from '../ui/Tabs';
import { Alert } from '../ui/Alert';
import { AiProvidersPanel } from './AiProvidersPanel';
import { ModelPicker } from './ModelPicker';

type Tab = 'connections' | 'tasks' | 'diagnostics' | 'mcp' | 'legacy';
const TABS = [{ id: 'connections', label: 'Connessioni' }, { id: 'tasks', label: 'Task' }, { id: 'diagnostics', label: 'Diagnostica' }, { id: 'mcp', label: 'MCP e proposte' }, { id: 'legacy', label: 'Provider API' }] as const;
const PROVIDERS = ['openrouter', 'cerebras', 'groq', 'openai', 'google', 'deepseek', 'xai', 'glm', 'mistral', 'anthropic', 'custom'];

function ProposalSummary({ proposal }: { proposal: Proposal }) {
  const p = proposal.payload as { channels?: string[]; searches?: { label: string; city: string; maxPrice: number; minRooms?: number; maxRooms?: number }[];
    zones?: { city: string; keep: string[]; avoid: string[] }[]; musts?: string[]; notes?: string };
  if (proposal.kind === 'scan') return <p className="my-3 text-sm">Raccogliere annunci dalle fonti: {p.channels?.join(', ')}. La proposta non esegue valutazioni AI.</p>;
  return <div className="my-3 space-y-2 text-sm">
    {p.searches?.map((search, i) => <p key={i}><b>{search.label || search.city}</b>: fino a {search.maxPrice} €/mese, locali {search.minRooms ?? 'qualsiasi'} – {search.maxRooms ?? 'senza massimo'}.</p>)}
    {p.zones?.map((zone, i) => <p key={i}>{zone.city}: preferiti {zone.keep.join(', ') || 'nessuna preferenza'}; da evitare {zone.avoid.join(', ') || 'nessuna esclusione'}.</p>)}
    <p>Requisiti: {p.musts?.join('; ') || 'nessuno'}</p><p className="whitespace-pre-wrap break-words">Note: {p.notes || 'nessuna'}</p>
  </div>;
}

export function ConnectionsPanel({ onChanged }: { onChanged?: () => void }) {
  const [config, setConfig] = useState<Connections | null>(null);
  const [tab, setTab] = useState<Tab>('connections');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [setup, setSetup] = useState<{ codexConfig: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { let active = true; agentJson<Connections>('/api/ai/connections').then((value) => { if (active) setConfig(value); }).catch((e: Error) => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const update = (id: string, patch: Partial<Connection>) => {
    if (patch.kind && patch.kind !== 'api') setSecrets((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)));
    setConfig((c) => c && ({ ...c, connections: c.connections.map((row) => row.id === id ? { ...row, ...patch } : row) })); setDirty(true);
  };
  const save = () => act(async () => {
    if (!config) return;
    const body = { ...config, connections: config.connections.map(({ hasKey: _hasKey, ...row }) => row), secrets };
    await agentJson('/api/ai/connections', 'PUT', body);
    setConfig(await agentJson<Connections>('/api/ai/connections')); setSecrets({}); setDirty(false);
    setMessage('Connessioni e task salvati.'); onChanged?.();
  });
  const route = (task: AiTask, id: string) => {
    if (!config) return;
    const tasks = { ...config.tasks };
    if (!id) delete tasks[task]; else tasks[task] = { connectionId: id, fallbackIds: [] };
    setConfig({ ...config, tasks }); setDirty(true);
  };
  const refreshProposals = async () => setProposals((await agentJson<{ proposals: Proposal[] }>('/api/agent/proposals')).proposals);
  return <section className="flex flex-col gap-5" aria-label="Connessioni AI">
    <div><h2 className="text-2xl">Connessioni AI</h2><p className="mt-1 max-w-[72ch] text-sm text-muted">Scegli un account locale o un provider e assegna ogni funzione alla connessione desiderata. Una connessione disponibile non viene attivata da sola.</p></div>
    <Tabs items={TABS} value={tab} onChange={setTab} label="Impostazioni AI" />
    {error && <Alert tone="danger" title="Operazione non completata">{error}</Alert>}
    {message && <p role="status" className="text-sm text-ok">{message}</p>}
    {!config && !error && <p aria-busy="true" className="text-sm text-muted">Caricamento connessioni…</p>}
    {config && tab === 'connections' && <>
      {config.connections.length === 0 && <p className="text-sm text-muted">Puoi usare Codex con il tuo account già collegato. Le chiavi API esistenti restano disponibili nella scheda Provider API.</p>}
      {config.connections.map((row) => <fieldset key={row.id} disabled={busy} className="min-w-0 border-b border-hair pb-5">
        <legend className="mb-3 font-semibold text-ink">{row.label}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome">{(p) => <Input {...p} value={row.label} maxLength={100} onChange={(e) => update(row.id, { label: e.target.value })} />}</Field>
          <Field label="Tipo">{(p) => <Select {...p} value={row.kind} onChange={(e) => update(row.id, { kind: e.target.value as Connection['kind'], vision: e.target.value === 'codex', ...(e.target.value === 'api' ? { provider: 'custom' } : {}) })}><option value="codex">Codex CLI, account locale</option><option value="claude">Claude Code, opzionale</option><option value="api">API / endpoint compatibile Hermes</option></Select>}</Field>
          <Field label="Modello" hint="Vuoto: usa il modello predefinito del client nativo.">{(p) => <Input {...p} value={row.model ?? ''} onChange={(e) => update(row.id, { model: e.target.value })} />}</Field>
          {row.kind === 'codex' && <Field label="Ragionamento">{(p) => <Select {...p} value={row.reasoning ?? 'high'} onChange={(e) => update(row.id, { reasoning: e.target.value as Connection['reasoning'] })}>{['minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => <option key={level}>{level}</option>)}</Select>}</Field>}
          {row.kind === 'api' && <>
            <Field label="Provider">{(p) => <Select {...p} value={row.provider ?? 'custom'} onChange={(e) => update(row.id, { provider: e.target.value })}>{PROVIDERS.map((id) => <option key={id}>{id}</option>)}</Select>}</Field>
            <Field label="Endpoint" hint="Hermes: endpoint già configurato, senza installazione automatica.">{(p) => <Input {...p} type="url" value={row.baseUrl ?? ''} placeholder="http://127.0.0.1:8000/v1" onChange={(e) => update(row.id, { baseUrl: e.target.value || undefined })} />}</Field>
            <Field label="Nuova chiave" hint={row.hasKey ? 'Chiave salvata. Lascia vuoto per conservarla.' : 'Facoltativa per endpoint locali che non la richiedono.'}>{(p) => <Input {...p} type="password" autoComplete="new-password" value={secrets[row.id] ?? ''} onChange={(e) => { const value = e.target.value; setSecrets((previous) => { const next = { ...previous }; if (value) next[row.id] = value; else delete next[row.id]; return next; }); setDirty(true); }} />}</Field>
          </>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={row.enabled} onChange={(e) => update(row.id, { enabled: e.target.checked })} /> Abilitata</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={row.vision} disabled={row.kind === 'claude'} onChange={(e) => update(row.id, { vision: e.target.checked })} /> Supporta immagini</label>
          <Button size="sm" variant="ghost" onClick={() => { setSecrets((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== row.id))); setConfig({ ...config, connections: config.connections.filter((c) => c.id !== row.id), tasks: Object.fromEntries(Object.entries(config.tasks).filter(([, r]) => r.connectionId !== row.id).map(([task, r]) => [task, { ...r, fallbackIds: r.fallbackIds.filter((id) => id !== row.id) }])) }); setDirty(true); }}>Rimuovi connessione</Button>
          {row.kind === 'api' && row.hasKey && <Button size="sm" variant="ghost" onClick={() => { setSecrets({ ...secrets, [row.id]: '' }); setDirty(true); setMessage('La chiave verrà rimossa al salvataggio.'); }}>Rimuovi chiave</Button>}
        </div>
        {row.kind === 'claude' && <p className="mt-2 text-xs text-muted">Richiede un account Claude Code abilitato. Il supporto predisposto non dimostra accesso o disponibilità live.</p>}
      </fieldset>)}
      <Button className="self-start" disabled={busy} onClick={() => { const id = `connection_${crypto.randomUUID().slice(0, 8)}`; setConfig({ ...config, connections: [...config.connections, { id, label: 'Codex personale', kind: 'codex', vision: true, enabled: true, reasoning: 'high' }] }); setDirty(true); }}>Aggiungi connessione</Button>
    </>}
    {config && tab === 'tasks' && <div className="flex flex-col gap-5">
      <p className="max-w-[72ch] text-sm text-muted">Una scelta esplicita usa soltanto il primario e i fallback indicati qui. Le altre chiavi salvate non entrano automaticamente nella catena.</p>
      {(Object.keys(TASK_LABELS) as AiTask[]).map((task) => <div key={task} className="border-b border-hair pb-4">
        <Field label={TASK_LABELS[task]}>{(p) => <Select {...p} value={config.tasks[task]?.connectionId ?? ''} onChange={(e) => route(task, e.target.value)}><option value="">Configurazione API precedente</option>{config.connections.filter((c) => c.enabled && (task !== 'vision' || c.vision)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>
        {config.tasks[task] && <details className="mt-2 text-xs text-muted"><summary>Fallback facoltativi, nell’ordine di selezione</summary><div className="mt-2 flex flex-wrap gap-4">{config.connections.filter((c) => c.enabled && c.id !== config.tasks[task]?.connectionId && (task !== 'vision' || c.vision)).map((c) => <label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={config.tasks[task]?.fallbackIds.includes(c.id) ?? false} onChange={(e) => { const r = config.tasks[task]!; setConfig({ ...config, tasks: { ...config.tasks, [task]: { ...r, fallbackIds: e.target.checked ? [...r.fallbackIds, c.id] : r.fallbackIds.filter((id) => id !== c.id) } } }); setDirty(true); }} />{c.label}</label>)}</div><p className="mt-2">Ordine attuale: {(config.tasks[task]?.fallbackIds ?? []).map((id) => config.connections.find((c) => c.id === id)?.label).join(' → ') || 'nessuno'}</p></details>}
      </div>)}
    </div>}
    {config && tab === 'diagnostics' && <div className="flex flex-col gap-4"><p className="text-sm text-muted">Diagnostica controlla client, account e modelli senza inferenza. La prova sintetica usa la quota della sola connessione scelta.</p>{config.connections.map((c) => <div key={c.id} className="border-b border-hair pb-4"><h3 className="text-xl">{c.label}</h3><div className="mt-2 flex flex-wrap gap-2"><Button disabled={busy || dirty} onClick={() => act(async () => { const d = await agentJson<{ installed: boolean; authenticated: boolean | null; ready: boolean; detail?: string; models: { id: string }[] }>(`/api/ai/connections/${c.id}/diagnostics`); setDiagnostics({ ...diagnostics, [c.id]: `${d.ready ? 'Pronta' : 'Non pronta'} · client ${d.installed ? 'disponibile' : 'assente'} · account ${d.authenticated === null ? 'non verificato' : d.authenticated ? 'collegato' : 'non collegato'}. ${d.detail ?? ''} Modelli: ${d.models.map((m) => m.id).join(', ') || 'non disponibili'}` }); })}>Diagnostica</Button><Button disabled={busy || dirty || !c.enabled} onClick={() => act(async () => { const d = await agentJson<{ ok: boolean; text?: string; detail?: string }>(`/api/ai/connections/${c.id}/test`, 'POST', {}); setDiagnostics({ ...diagnostics, [c.id]: d.ok ? `Prova riuscita: ${d.text ?? 'risposta valida'}` : d.detail ?? 'Prova non riuscita' }); })}>Prova sintetica</Button></div><p className="mt-2 break-words text-sm" role="status">{diagnostics[c.id] ?? 'Nessuna prova eseguita.'}</p></div>)}</div>}
    {tab === 'mcp' && <div className="flex flex-col gap-4"><h3 className="text-xl">Collega un assistente esterno</h3><p className="max-w-[72ch] text-sm text-muted">L’app deve essere aperta. Il client può consultare annunci e modificare stati reversibili; ricerca e profilo passano dalle proposte qui sotto.</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => act(async () => setSetup(await agentJson('/api/agent/setup', 'POST', {})))}>Prepara collegamento MCP</Button><Button disabled={busy} onClick={() => act(refreshProposals)}>Aggiorna proposte</Button></div>{setup && <details open><summary className="text-sm">Configurazione Codex</summary><pre className="mt-2 overflow-x-auto rounded bg-surface-2 p-3 text-xs">{setup.codexConfig}</pre><Button size="sm" onClick={() => { void navigator.clipboard.writeText(setup.codexConfig).then(() => setMessage('Configurazione copiata.')).catch(() => setError('Copia non disponibile. Seleziona il testo.')); }}>Copia configurazione</Button></details>}{proposals.length === 0 && <p className="text-sm text-muted">Nessuna proposta caricata. Aggiorna per leggere quelle inviate dal client.</p>}{proposals.map((p) => <div key={p.id} className="border-t border-hair pt-3"><h4 className="text-lg">{p.kind === 'profile' ? 'Modifica della ricerca' : 'Scansione delle fonti'} · {p.state}</h4><ProposalSummary proposal={p} />{p.state === 'pending' && <div className="flex gap-2"><Button disabled={busy} onClick={() => act(async () => { await agentJson(`/api/agent/proposals/${p.id}/confirm`, 'POST', {}); await refreshProposals(); onChanged?.(); })}>Conferma nella UI</Button><Button disabled={busy} onClick={() => act(async () => { await agentJson(`/api/agent/proposals/${p.id}/reject`, 'POST', {}); await refreshProposals(); })}>Rifiuta</Button></div>}{p.error && <p className="text-sm text-danger">{p.error}</p>}</div>)}</div>}
    <div hidden={tab !== 'legacy'}>{tab === 'legacy' && <><p className="mb-4 text-sm text-muted">Le configurazioni API sono conservate. I task assegnati a Codex continuano a usare Codex anche se cambi il provider precedente.</p><AiProvidersPanel onChanged={onChanged} /><ModelPicker onChanged={onChanged} /></>}</div>
    {config && ['connections', 'tasks'].includes(tab) && <div className="sticky bottom-2 flex flex-wrap items-center gap-3 rounded border border-hair bg-surface px-3 py-3"><Button variant="primary" loading={busy} disabled={!dirty && Object.keys(secrets).length === 0} onClick={save}>Salva connessioni e task</Button><span className="text-xs text-muted">{dirty ? 'Modifiche non salvate' : 'Nessuna modifica da salvare'}</span></div>}
    {dirty && ['diagnostics', 'mcp'].includes(tab) && <p className="text-sm text-warn">Salva le modifiche prima di provare una connessione.</p>}
  </section>;
}
