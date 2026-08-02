import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useMeta } from './hooks';
import { Dashboard, DEFAULT_FILTERS } from './components/Dashboard';
import { RunPanel } from './components/RunPanel';
import { ConfigView, type ConfigTab } from './components/ConfigView';
import { ProfileView } from './components/Profile/ProfileView';
import { ThemeToggle } from './components/ThemeToggle';
import type { ListingFilters } from './types';
import { Alert } from './ui/Alert';
import { Kicker } from './ui/Kicker';
import { Tabs } from './ui/Tabs';

type View = 'dashboard' | 'run' | 'profile' | 'config';

const NAV = [
  { id: 'dashboard', label: 'Annunci' },
  { id: 'run', label: 'Cerca' },
  { id: 'profile', label: 'Profilo' },
  { id: 'config', label: 'Config' },
] as const;

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [metaToken, setMetaToken] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  // I filtri vivono qui: prima erano dentro Dashboard e si perdevano a ogni cambio tab.
  const [filters, setFilters] = useState<ListingFilters>(DEFAULT_FILTERS);
  // Le viste si montano alla prima visita e poi restano vive: niente refetch e niente
  // EventSource richiuso ogni volta che si cambia scheda.
  const [visited, setVisited] = useState<Set<View>>(new Set(['dashboard']));
  const { meta, error: metaError } = useMeta(metaToken);
  // Solo il cartellino: il pannello con i passi e il pulsante vive in Config → App.
  const [nuovaVersione, setNuovaVersione] = useState<string | null>(null);
  // Quale scheda di Config aprire quando ci si arriva da un pulsante altrove. Si azzera dopo,
  // altrimenti la scelta di un momento resterebbe appiccicata a ogni visita successiva.
  const [configTab, setConfigTab] = useState<ConfigTab | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .checkUpdate()
      .then((i) => {
        if (vivo && i.updateAvailable) setNuovaVersione(i.latest);
      })
      .catch(() => {
        /* nessuna rete: l'app funziona lo stesso, e non si annuncia niente */
      });
    return () => {
      vivo = false;
    };
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    setVisited((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
  }, []);

  /**
   * Va in Config aprendo la scheda giusta.
   *
   * Il "Modifica" del profilo prima chiamava `go('config')` e basta: tecnicamente funzionava, ma
   * atterrava sui criteri grezzi e quindi sembrava un tasto rotto. La scheda scelta si azzera
   * subito dopo, altrimenti resterebbe imposta a ogni visita successiva.
   */
  const apriConfig = useCallback(
    (t: ConfigTab) => {
      setConfigTab(t);
      go('config');
      setTimeout(() => setConfigTab(null), 0);
    },
    [go],
  );

  // A run finita l'archivio è cambiato: prima `onDone` era un no-op e la lista restava vecchia.
  const onRunDone = useCallback(() => {
    setRefreshToken((n) => n + 1);
    setMetaToken((n) => n + 1);
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-[1380px] px-4 py-5">
      <header className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-hair pb-4">
        <div>
          <Kicker as="div" tone="accent">
            monitor affitti
          </Kicker>
          <h1 className="text-2xl text-ink">House&nbsp;Finder</h1>
        </div>

        <nav aria-label="Sezioni">
          <Tabs items={NAV} value={view} onChange={go} label="Sezioni" />
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {nuovaVersione && (
            <button
              onClick={() => apriConfig('app')}
              className="rounded-[var(--radius-btn)] bg-accent-soft px-2.5 py-1 text-xs text-accent hover:underline"
            >
              Aggiornamento disponibile: {nuovaVersione}
            </button>
          )}
          {meta && !meta.aiConfigured && (
            <button
              onClick={() => go('config')}
              className="rounded-[var(--radius-btn)] bg-warn-soft px-2.5 py-1 text-xs text-warn hover:underline"
            >
              Nessun provider AI configurato
            </button>
          )}
          {meta && meta.aiConfigured && !meta.imapConfigured && (
            <span className="text-xs text-faint">IMAP non configurato — canale email spento</span>
          )}
          <ThemeToggle />
        </div>
      </header>

      {metaError && (
        <Alert tone="danger" title="Server non raggiungibile" className="mb-4">
          {metaError}. Avvia il server con <code>npm start</code> e ricarica la pagina.
        </Alert>
      )}

      <main>
        <div hidden={view !== 'dashboard'}>
          <Dashboard
            filters={filters}
            onFilters={setFilters}
            refreshToken={refreshToken}
            channels={meta?.channels ?? []}
            onGoToRun={() => go('run')}
          />
        </div>

        {visited.has('run') && (
          <div hidden={view !== 'run'}>
            <RunPanel meta={meta} onDone={onRunDone} />
          </div>
        )}

        {visited.has('profile') && (
          <div hidden={view !== 'profile'}>
            <ProfileView
              meta={meta}
              refreshToken={refreshToken}
              onEditSearch={() => apriConfig('search')}
              onGoToProviders={() => apriConfig('providers')}
              onGoToRun={() => go('run')}
            />
          </div>
        )}

        {visited.has('config') && (
          <div hidden={view !== 'config'}>
            <ConfigView
              onProvidersChanged={() => setMetaToken((n) => n + 1)}
              openTab={configTab}
              meta={meta}
            />
          </div>
        )}
      </main>
    </div>
  );
}
