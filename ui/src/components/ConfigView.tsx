import { useEffect, useState } from 'react';
import { api } from '../api';
import { AiProvidersPanel } from './AiProvidersPanel';
import { ModelPicker } from './ModelPicker';
import { UpdatePanel } from './UpdatePanel';
import { BrowsersPanel } from './BrowsersPanel';
import { MailPanel } from './MailPanel';
import { FacebookSession } from './FacebookSession';
import { FacebookGroups } from './FacebookGroups';
import { SearchEditor } from './SearchEditor';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Tabs } from '../ui/Tabs';
import type { Meta } from '../types';

export type ConfigTab = 'search' | 'email' | 'facebook' | 'providers' | 'app';
type Danger = 'reset' | 'refilter' | null;

/**
 * Le impostazioni, divise per **cosa vuoi fare**, non per quale file c'è sotto.
 *
 * Prima i tab erano "Criteri (AI)", "Ricerche/zone" e "Gruppi FB", e i primi due erano una casella
 * di testo con dentro rispettivamente un prompt markdown e un array JSON con `minRooms`. Erano i
 * nomi dei file, non le domande di chi li apriva — e la zona pericolosa, con "Svuota archivio",
 * compariva in fondo a ognuno di essi.
 */
const TABS = [
  { id: 'search', label: 'La tua ricerca' },
  { id: 'email', label: 'Email' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'providers', label: 'Provider AI' },
  { id: 'app', label: 'App' },
] as const;

export function ConfigView({
  onProvidersChanged,
  openTab,
  meta,
}: {
  onProvidersChanged?: () => void;
  /** Tab da aprire su richiesta esterna (il badge dell'header, il tasto Modifica del profilo). */
  openTab?: ConfigTab | null;
  meta?: Meta | null;
}) {
  const [tab, setTab] = useState<ConfigTab>('search');

  useEffect(() => {
    if (openTab) setTab(openTab);
  }, [openTab]);

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

      {tab === 'search' && <SearchEditor onSaved={onProvidersChanged} />}

      {tab === 'email' && <MailPanel onChanged={onProvidersChanged} />}

      {tab === 'facebook' && (
        <div className="flex flex-col gap-4">
          {/* La sessione sta sopra l'elenco: senza accesso, i gruppi non si possono leggere. */}
          <FacebookSession onChanged={onProvidersChanged} />
          <FacebookGroups />
        </div>
      )}

      {tab === 'providers' && (
        <div className="flex flex-col gap-4">
          <ModelPicker onChanged={onProvidersChanged} />
          <AiProvidersPanel onChanged={onProvidersChanged} />
        </div>
      )}

      {tab === 'app' && (
        <div className="flex flex-col gap-4">
          <UpdatePanel />
          <BrowsersPanel meta={meta ?? null} onChanged={onProvidersChanged} />

          {/* Una volta sola, e nella scheda che parla dell'app — non in fondo a ogni schermata. */}
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
        </div>
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
