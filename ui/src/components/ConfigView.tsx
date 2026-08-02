import { useEffect, useState } from 'react';
import { api } from '../api';
import { AiProvidersPanel } from './AiProvidersPanel';
import { ModelPicker } from './ModelPicker';
import { UpdatePanel } from './UpdatePanel';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Tabs } from '../ui/Tabs';

type Tab = 'criteria' | 'searches' | 'facebook' | 'providers' | 'app';
type SaveState = 'idle' | 'saving' | 'ok' | 'err';
type Danger = 'reset' | 'refilter' | null;

const TABS = [
  { id: 'criteria', label: 'Criteri (AI)' },
  { id: 'searches', label: 'Ricerche/zone' },
  { id: 'facebook', label: 'Gruppi FB' },
  { id: 'providers', label: 'Provider AI' },
  { id: 'app', label: 'App' },
] as const;

/** I tab che non sono un editor di testo: niente caricamento del contenuto, niente Salva. */
const NON_EDITOR: readonly Tab[] = ['providers', 'app'];

export function ConfigView({
  onProvidersChanged,
  openTab,
}: {
  onProvidersChanged?: () => void;
  /** Tab da aprire su richiesta esterna (il badge "aggiornamento disponibile" nell'header). */
  openTab?: Tab | null;
}) {
  const [tab, setTab] = useState<Tab>('criteria');

  useEffect(() => {
    if (openTab) setTab(openTab);
  }, [openTab]);

  const [text, setText] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [save, setSave] = useState<SaveState>('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (NON_EDITOR.includes(tab)) return;
    setSave('idle');
    setMsg('');
    setLoadErr('');
    const load =
      tab === 'criteria'
        ? api.getCriteria().then((c) => c.content)
        : (tab === 'searches' ? api.getSearches() : api.getFacebook()).then((d) =>
            JSON.stringify(d, null, 2),
          );
    // Prima questo `then` era senza catch: col server giù restava il testo del tab precedente.
    load.then(setText).catch((e: Error) => {
      setText('');
      setLoadErr(e.message);
    });
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
          setMsg('JSON non valido: controlla virgole e parentesi.');
          return;
        }
        res = tab === 'searches' ? await api.putSearches(parsed) : await api.putFacebook(parsed);
      }
      if (res.ok) {
        setSave('ok');
        setMsg('Salvato in data/local. Vale dal prossimo run.');
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

  const [danger, setDanger] = useState<Danger>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState('');

  async function runDanger() {
    setDangerBusy(true);
    try {
      if (danger === 'reset') {
        const r = await api.resetListings();
        setResetMsg(`Archivio svuotato: ${r.cleared} annunci rimossi.`);
      } else {
        const r = await api.refilterListings();
        setResetMsg(`Ripulito: ${r.removed} rimossi, restano ${r.after}.`);
      }
    } catch (e) {
      setResetMsg(`Errore: ${(e as Error).message}`);
    } finally {
      setDangerBusy(false);
      setDanger(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs items={TABS} value={tab} onChange={setTab} label="Sezioni di configurazione" />

      {tab === 'app' ? (
        <UpdatePanel />
      ) : tab === 'providers' ? (
        <div className="flex flex-col gap-4">
          <ModelPicker onChanged={onProvidersChanged} />
          <AiProvidersPanel onChanged={onProvidersChanged} />
        </div>
      ) : (
        <>
          {loadErr && (
            <Alert tone="danger" title="Configurazione non caricata">
              {loadErr}. Verifica che il server sia acceso, poi ricarica la pagina.
            </Alert>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label={TABS.find((t) => t.id === tab)?.label}
            className="h-[55vh] w-full rounded-[var(--radius-card)] border border-line bg-surface-hi p-4 font-mono text-sm text-ink"
            style={{ fontFamily: 'var(--font-mono)' }}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={onSave} loading={save === 'saving'}>
              Salva
            </Button>
            {msg && (
              <span className={`text-sm ${save === 'ok' ? 'text-ok' : 'text-danger'}`}>{msg}</span>
            )}
            {tab !== 'criteria' && <span className="text-xs text-faint">Formato JSON.</span>}
          </div>

          <Card className="border-danger/30">
            <CardHeader kicker="irreversibile" title="Zona pericolosa" />
            <div className="flex flex-wrap items-center gap-3 p-4">
              <Button variant="secondary" onClick={() => setDanger('refilter')}>
                Ripulisci rumore
              </Button>
              <Button variant="danger" onClick={() => setDanger('reset')}>
                Svuota archivio
              </Button>
              <p className="flex-1 text-xs text-muted">
                <b>Ripulisci</b> toglie il rumore Facebook (commenti, chrome) e i non-affitti, senza
                toccare il resto e senza usare l'AI. <b>Svuota</b> cancella tutto: al prossimo run gli
                annunci vengono ri-trovati e ri-valutati da zero.
              </p>
              {resetMsg && <span className="text-sm text-ink-soft">{resetMsg}</span>}
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={danger !== null}
        busy={dangerBusy}
        title={danger === 'reset' ? 'Svuotare tutto l’archivio?' : 'Ripulire il rumore?'}
        confirmLabel={danger === 'reset' ? 'Svuota' : 'Ripulisci'}
        onCancel={() => setDanger(null)}
        onConfirm={runDanger}
      >
        {danger === 'reset'
          ? 'Vengono cancellati tutti gli annunci, i voti e gli stati (preferiti, contattati). Al prossimo run verranno ri-trovati e ri-valutati da zero, consumando quota AI.'
          : 'Vengono rimossi i record riconosciuti come rumore (commenti Facebook, elementi di interfaccia, annunci che non sono affitti). L’operazione non usa l’AI e non è reversibile.'}
      </ConfirmDialog>
    </div>
  );
}
