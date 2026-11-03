import { useEffect, useRef, useState } from 'react';
import { agentJson, type ChatContext, type ChatThread } from '../agent-api';
import { api } from '../api';
import type { ListingFilters, StoredListing } from '../types';
import { Button } from '../ui/Button';
import { Field, Select } from '../ui/Field';
import { Alert } from '../ui/Alert';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export function ChatPanel({ filters, refreshToken, onConfigure }: { filters: ListingFilters; refreshToken: number; onConfigure: () => void }) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState('');
  const [records, setRecords] = useState<StoredListing[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [context, setContext] = useState<ChatContext | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const active = threads.find((thread) => thread.id === activeId);
  const load = async () => {
    const result = await agentJson<{ threads: ChatThread[] }>('/api/chat/threads');
    setThreads(result.threads);
    setActiveId((id) => result.threads.some((thread) => thread.id === id) ? id : result.threads[0]?.id ?? '');
  };
  useEffect(() => { void load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    const controller = new AbortController();
    api.listings(filters, controller.signal).then((all) => {
      const visible = all.slice(0, 20);
      setRecords(visible);
      setKeys((current) => current.filter((key) => visible.some((row) => row.key === key)));
    }).catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [filters, refreshToken]);
  useEffect(() => {
    let alive = true;
    agentJson<ChatContext>('/api/chat/context', 'POST', { keys }).then((value) => { if (alive) setContext(value); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [keys, refreshToken]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [active?.messages.length, busy]);
  useEffect(() => {
    if (!active?.busy || busy) return;
    const timer = setInterval(() => { void load().catch((e: Error) => setError(e.message)); }, 2000);
    return () => clearInterval(timer);
  }, [active?.busy, busy]);
  const create = async (): Promise<ChatThread> => {
    const thread = await agentJson<ChatThread>('/api/chat/threads', 'POST', {});
    setThreads((list) => [thread, ...list]); setActiveId(thread.id); return thread;
  };
  const send = async () => {
    if (!text.trim() || busy) return;
    const value = text.trim(); setError(''); setBusy(true);
    let id = activeId;
    try {
      if (!id) id = (await create()).id;
      setText('');
      const response = agentJson<ChatThread>(`/api/chat/threads/${id}/messages`, 'POST', { text: value, keys });
      // The server persists the submitted message before calling the runtime.
      setThreads((list) => list.map((t) => t.id !== id ? t : { ...t, messages: [...t.messages, { id: 'pending', role: 'user', content: value, createdAt: new Date().toISOString() }] }));
      const thread = await response;
      setThreads((list) => list.map((t) => t.id === id ? thread : t));
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally { setBusy(false); }
  };
  const remove = async () => {
    try { await agentJson(`/api/chat/threads/${activeId}`, 'DELETE'); setShowDelete(false); await load(); }
    catch (e) { setError((e as Error).message); }
  };
  return <section aria-label="Chat sugli annunci" className="grid gap-6 lg:grid-cols-[minmax(230px,300px)_minmax(0,1fr)]">
    <aside className="min-w-0 border-b border-hair pb-5 lg:border-b-0 lg:pr-5">
      <h2 className="text-2xl">Parliamo delle case</h2>
      <p className="mt-2 max-w-[65ch] text-sm text-muted">Confronta gli annunci e chiarisci i dubbi. La chat consulta i dati selezionati, senza modificarli o contattare nessuno.</p>
      <div className="my-4 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { void create().catch((e: Error) => setError(e.message)); }}>Nuova conversazione</Button><Button variant="ghost" size="sm" onClick={onConfigure}>Connessione AI</Button></div>
      <Field label="Conversazioni salvate sul PC">{(p) => <Select {...p} value={activeId} disabled={busy} onChange={(e) => setActiveId(e.target.value)}><option value="">Nuova conversazione</option>{threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</Select>}</Field>
      {active && <Button size="sm" variant="ghost" className="mt-2" disabled={busy || active.busy} onClick={() => setShowDelete(true)}>Elimina conversazione</Button>}
      <div className="mt-6 border-t border-hair pt-4"><h3 className="text-xl">Contesto della prossima domanda</h3><p className="mt-2 text-xs text-muted">Ricerca corrente e statistiche dell’archivio. Puoi aggiungere fino a 20 annunci tra i risultati dei filtri di Annunci.</p>
        {context && <p className="mt-2 text-sm">{context.stats.total} annunci in archivio · {keys.length} selezionati</p>}
        {context?.profile.searches.map((search, i) => <p key={i} className="mt-1 text-xs text-muted">{search.label} · fino a {search.maxPrice} €/mese</p>)}
        <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">{records.map((row) => <label key={row.key} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy} checked={keys.includes(row.key)} onChange={(e) => setKeys((list) => e.target.checked ? [...list, row.key] : list.filter((key) => key !== row.key))} /><span className="min-w-0 break-words">{row.listing.title}<span className="block text-xs text-muted">{row.listing.price != null ? `${row.listing.price} €/mese` : 'Prezzo non indicato'} · {row.listing.zone}</span></span></label>)}{records.length === 0 && <p className="text-sm text-muted">Nessun annuncio corrisponde ai filtri. Puoi comunque parlare della tua ricerca.</p>}</div>
        {context && <details className="mt-3 text-xs text-muted"><summary>Anteprima dei dati degli annunci inviati</summary>{context.listings.map((row) => <div key={row.key} className="mt-3"><b>{row.title}</b><p className="whitespace-pre-wrap break-words">{row.description || 'Descrizione assente'}</p></div>)}</details>}
      </div>
    </aside>
    <div className="min-w-0">
      {error && <Alert tone="danger" title="Risposta non completata" className="mb-4">{error}</Alert>}
      <div aria-live="polite" aria-busy={busy || loading} role="log" aria-label="Conversazione" className="max-h-[65vh] min-h-64 space-y-5 overflow-y-auto pb-5 pr-2">
        {loading && <p className="text-sm text-muted">Caricamento conversazioni…</p>}
        {!loading && !active?.messages.length && <div className="py-8"><h3 className="text-2xl">Una scelta alla volta</h3><p className="mt-2 max-w-[65ch] text-sm text-muted">Seleziona due o più annunci e chiedi, per esempio, quali rispettano meglio il budget e quali informazioni mancano prima di fissare una visita.</p></div>}
        {active?.messages.map((entry) => <article key={entry.id} className={entry.role === 'user' ? 'rounded bg-surface-2 px-4 py-3' : 'px-1 py-2'}><p className="mb-2 text-xs font-semibold text-muted">{entry.role === 'user' ? 'Tu' : 'House Finder'}</p><p className="max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.content}</p>{entry.context && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted"><span>Contesto del {new Date(entry.context.capturedAt).toLocaleString('it-IT')}</span>{entry.context.listings.map((row) => /^https?:\/\//i.test(row.url) ? <a key={row.key} href={row.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{row.title}</a> : <span key={row.key}>{row.title}</span>)}</div>}</article>)}
        {(busy || active?.busy) && <p role="status" className="text-sm text-muted">In attesa della connessione AI. Puoi annullare la richiesta.</p>}<div ref={end} />
      </div>
      <form className="border-t border-hair pt-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="chat-question" className="mb-2 block text-sm font-semibold">La tua domanda</label>
        <textarea id="chat-question" value={text} maxLength={8000} disabled={busy} rows={4} onChange={(e) => setText(e.target.value)} className="w-full resize-y rounded border border-line bg-surface-hi p-3 text-sm text-ink" placeholder="Quale di queste case è più adatta alla mia ricerca?" />
        <div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="primary" type="submit" loading={busy} disabled={!text.trim() || active?.busy}>Invia domanda</Button>{(busy || active?.busy) && <Button type="button" onClick={() => { void agentJson(`/api/chat/threads/${activeId}/cancel`, 'POST', {}).catch((e: Error) => setError(e.message)); }}>Annulla risposta</Button>}<span className="text-xs text-muted">Cronologia locale. La richiesta usa la connessione assegnata al task Chat.</span></div>
      </form>
    </div>
    <ConfirmDialog open={showDelete} title="Eliminare questa conversazione?" confirmLabel="Elimina" onCancel={() => setShowDelete(false)} onConfirm={() => { void remove(); }}>La conversazione viene rimossa dalla cronologia locale.</ConfirmDialog>
  </section>;
}
