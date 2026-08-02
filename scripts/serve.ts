/**
 * L'avvio del server.
 *
 * Da quando l'app può partire senza finestra (icona nella tray, `HouseFinder.vbs`) questo file
 * fa anche il lavoro che prima stava dentro `HouseFinder.bat`: crea `state/` e il `.env` al primo
 * avvio, apre il browser, e soprattutto è l'unico posto che ha in mano l'`http.Server` — quindi
 * l'unico che sappia spegnersi davvero quando lo chiedono la tray o l'aggiornamento.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { ListingStore } from '../src/core/store.js';
import { createApp } from '../src/server/app.js';
import { startTray, trayRequested } from '../src/server/tray.js';
import { teeConsoleToFile } from '../src/server/logfile.js';
import { readLock } from '../src/update/lock.js';
import { APP_VERSION } from '../src/version.js';

const PORT = Number(process.env.PORT ?? '3000');
const STATE_DIR = process.env.STATE_DIR ?? 'state';
const URL_LOCALE = `http://localhost:${PORT}`;
/** Lo mette l'aggiornatore quando riaccende l'app: cambia tre comportamenti all'avvio. */
const APPENA_AGGIORNATO = process.env.HOUSE_FINDER_UPDATED === '1';
/** Lo passano i launcher del bundle: da terminale non si vuole una scheda che si apre da sola. */
const APRI_BROWSER = process.argv.includes('--open');

/** Quello che faceva il `.bat`: ora vale anche per il launcher senza console. */
function preparaCartella(): void {
  mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync('.env') && existsSync('.env.example')) {
    copyFileSync('.env.example', '.env');
    console.log('[avvio] creato .env da .env.example');
  }
}

function apriBrowser(url: string): void {
  if (process.platform !== 'win32') return;
  try {
    spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' })
      .unref();
  } catch {
    // Nessun browser aperto: l'indirizzo è comunque nel log e nel tooltip della tray.
  }
}

/** C'è già un House Finder in ascolto su questa porta? */
async function haRisposto(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/meta`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string';
  } catch {
    return false;
  }
}

/**
 * Un aggiornamento in corso vieta l'avvio.
 *
 * Se l'utente riapre l'app mentre l'aggiornatore sta copiando, `node.exe` torna bloccato e la
 * copia fallisce: è il "fermo al 95%" classico di Job Finder. Il processo che l'aggiornatore
 * stesso riaccende porta `HOUSE_FINDER_UPDATED=1` e salta la guardia, altrimenti troverebbe un
 * lucchetto ancora fresco e si rifiuterebbe di partire aspettando un aggiornatore che non c'è più.
 */
function aggiornamentoInCorso(): boolean {
  if (APPENA_AGGIORNATO) return false;
  const lock = readLock(STATE_DIR);
  return lock !== null && !lock.stale;
}

async function main(): Promise<void> {
  preparaCartella();
  teeConsoleToFile(STATE_DIR);
  // Il `.env` può essere appena stato creato: si carica dopo averlo preparato.
  await import('dotenv/config');

  if (aggiornamentoInCorso()) {
    console.warn('[avvio] aggiornamento in corso: non parto, riprova fra un minuto.');
    return;
  }

  const store = await ListingStore.load();
  let server: ReturnType<typeof app.listen> | null = null;
  let tray: { stop: () => void } | null = null;
  let spegnimentoInCorso = false;

  const spegni = (): void => {
    if (spegnimentoInCorso) return;
    spegnimentoInCorso = true;
    console.log('[server] spengo.');
    tray?.stop();
    // `close` non chiude le connessioni già aperte (la SSE della run resta lì): il timer è la
    // garanzia che si esca comunque, invece di restare appesi con l'icona già sparita.
    const ghigliottina = setTimeout(() => process.exit(0), 3000);
    ghigliottina.unref();
    server?.close(() => process.exit(0));
  };

  const app = createApp({ store, stateDir: STATE_DIR, onShutdown: spegni });

  // Bind SOLO su localhost: niente esposizione sulla LAN (nessuna auth su reset/config).
  server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`🏠 House Finder ${APP_VERSION} — server su ${URL_LOCALE}`);
    console.log(`   Archivio: ${store.size} annunci. Dev UI: npm run ui:dev (Vite :5173).`);
    if (trayRequested()) tray = startTray(URL_LOCALE);
    // Dopo un aggiornamento la scheda del browser è già aperta e si sta ricaricando da sola:
    // aprirne una seconda è il difetto "due tab dopo l'update" di Job Finder.
    if (APRI_BROWSER && !APPENA_AGGIORNATO) apriBrowser(URL_LOCALE);
  });

  server.on('error', async (e: NodeJS.ErrnoException) => {
    if (e.code === 'EACCES') {
      // Su Windows non è (solo) questione di permessi: Hyper-V/WSL riservano interi intervalli di
      // porte effimere, e una porta dentro uno di quelli dà EACCES anche se nessuno la sta usando.
      console.error(
        `[avvio] la porta ${PORT} è riservata dal sistema (succede con Hyper-V/WSL). ` +
          `Scegline un'altra con PORT=<numero>, o guarda l'elenco con ` +
          `\`netsh interface ipv4 show excludedportrange protocol=tcp\`.`,
      );
      process.exit(1);
    }
    if (e.code !== 'EADDRINUSE') throw e;
    // Istanza singola senza mutex nativo: se sulla porta risponde già House Finder, la cosa utile
    // è portare l'utente lì, non stampargli un errore.
    if (await haRisposto()) {
      console.log(`[avvio] House Finder è già in ascolto su ${URL_LOCALE}: apro quello.`);
      apriBrowser(URL_LOCALE);
      process.exit(0);
    }
    console.error(`[avvio] la porta ${PORT} è occupata da qualcos'altro.`);
    process.exit(1);
  });

  process.on('SIGINT', spegni);
  process.on('SIGTERM', spegni);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
