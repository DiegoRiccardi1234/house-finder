import { useJob } from '../hooks';
import { api } from '../api';
import type { Meta } from '../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { JobLog } from './JobLog';

/**
 * L'installazione dei browser, da un pulsante.
 *
 * Senza Chromium quattro canali su cinque risultano non disponibili, e la soluzione era
 * `install-browsers.bat`: un doppio click che apre una console, facile da saltare e impossibile
 * da capire se lo salti. Qui il pulsante sta accanto allo stato che lo motiva.
 */
export function BrowsersPanel({ meta, onChanged }: { meta: Meta | null; onChanged?: () => void }) {
  const { state, busy, start } = useJob('install-browsers');
  const installati = meta?.browsersInstalled === true;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base text-ink">Browser</h3>
          <p className="text-xs text-muted">
            Servono a Subito, Immobiliare, Idealista e Facebook, che si leggono solo con un browser
            vero. Sono ~400 MB e non stanno nel pacchetto scaricabile: si prendono una volta sola.
          </p>
        </div>
        <Badge tone={installati ? 'ok' : 'warn'}>{installati ? 'installati' : 'mancanti'}</Badge>
      </div>

      <JobLog state={state} />

      {!installati && (
        <div>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() =>
              void start(() => api.installBrowsers()).then(() => {
                onChanged?.();
              })
            }
          >
            Installa i browser
          </Button>
        </div>
      )}
      {installati && state?.outcome !== 'ok' && (
        <p className="text-xs text-faint">Tutto a posto: nessuna azione richiesta.</p>
      )}
    </Card>
  );
}
