import { useEffect, useState } from 'react';
import { api } from '../api';

type Tab = 'criteria' | 'searches' | 'facebook';
type SaveState = 'idle' | 'saving' | 'ok' | 'err';

export function ConfigView() {
  const [tab, setTab] = useState<Tab>('criteria');
  const [text, setText] = useState('');
  const [save, setSave] = useState<SaveState>('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setSave('idle');
    setMsg('');
    if (tab === 'criteria') api.getCriteria().then((c) => setText(c.content));
    else if (tab === 'searches') api.getSearches().then((d) => setText(JSON.stringify(d, null, 2)));
    else api.getFacebook().then((d) => setText(JSON.stringify(d, null, 2)));
  }, [tab]);

  async function onSave() {
    setSave('saving');
    setMsg('');
    try {
      let res: Response;
      if (tab === 'criteria') {
        res = await api.putCriteria(text);
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setSave('err');
          setMsg('JSON non valido.');
          return;
        }
        res = tab === 'searches' ? await api.putSearches(parsed) : await api.putFacebook(parsed);
      }
      if (res.ok) {
        setSave('ok');
        setMsg('Salvato. Vale dal prossimo run.');
      } else {
        const body = await res.json().catch(() => ({}));
        const issues = Array.isArray(body.issues)
          ? ' — ' + body.issues.map((i: { message?: string }) => i.message).filter(Boolean).join('; ')
          : '';
        setSave('err');
        setMsg(`Rifiutato: ${body.error ?? res.status}${issues}`);
      }
    } catch (e) {
      setSave('err');
      setMsg((e as Error).message);
    }
  }

  const [resetMsg, setResetMsg] = useState('');
  async function onReset() {
    if (!window.confirm('Svuotare tutto l\'archivio annunci? Al prossimo run verranno ri-trovati e ri-valutati da zero.')) return;
    setResetMsg('Svuoto…');
    try {
      const r = await api.resetListings();
      setResetMsg(`Archivio svuotato (${r.cleared} annunci rimossi).`);
    } catch (e) {
      setResetMsg(`Errore: ${(e as Error).message}`);
    }
  }
  async function onRefilter() {
    if (!window.confirm('Ripulire l\'archivio da rumore FB e non-affitti? Alcuni record verranno rimossi (irreversibile).')) return;
    setResetMsg('Ripulisco…');
    try {
      const r = await api.refilterListings();
      setResetMsg(`Ripulito: ${r.removed} rimossi (rumore FB/non-affitti). Restano ${r.after}.`);
    } catch (e) {
      setResetMsg(`Errore: ${(e as Error).message}`);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'criteria', label: 'Criteri (AI)' },
    { id: 'searches', label: 'Ricerche/zone' },
    { id: 'facebook', label: 'Gruppi FB' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === t.id ? 'bg-teal-700 text-white' : 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-[55vh] w-full rounded-2xl border border-stone-300 bg-white p-4 font-mono text-sm dark:border-stone-700 dark:bg-stone-900"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={save === 'saving'}
          className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {save === 'saving' ? 'Salvo…' : 'Salva'}
        </button>
        {msg && (
          <span className={`text-sm ${save === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{msg}</span>
        )}
        {tab !== 'criteria' && <span className="text-xs text-stone-500">Formato JSON.</span>}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-rose-300 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/40">
        <button
          onClick={onRefilter}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
        >
          🧹 Ripulisci rumore
        </button>
        <button
          onClick={onReset}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
        >
          🗑 Svuota archivio
        </button>
        <span className="text-xs text-stone-600 dark:text-stone-400">
          <b>Ripulisci</b>: toglie rumore FB (commenti/chrome) e non-affitti senza toccare il resto (no AI).
          <b>Svuota</b>: cancella tutto, al prossimo run si ri-trova e ri-valuta da zero.
        </span>
        {resetMsg && <span className="ml-auto text-sm text-rose-700 dark:text-rose-300">{resetMsg}</span>}
      </div>
    </div>
  );
}
