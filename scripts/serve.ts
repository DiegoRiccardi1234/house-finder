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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Lo mette l'aggiornatore quando riaccende l'app: cambia tre comportamenti all'avvio. */
/** Lo passano i launcher del bundle: da terminale non si vuole una scheda che si apre da sola. */
const APRI_BROWSER = process.argv.includes('--open');

/** Quello che faceva il `.bat`: ora vale anche per il launcher senza console. */
export async function prepareEnvironment(cwd = process.cwd()): Promise<{ port: number; stateDir: string }> {
  const envFile = join(cwd, '.env');
  const rootExample = join(cwd, '.env.example');
  const bundleExample = join(cwd, 'app', '.env.example');
  const appExample = existsSync(bundleExample) ? bundleExample : fileURLToPath(new URL('../.env.example', import.meta.url));
  const example = existsSync(rootExample) ? rootExample : appExample;
  if (!existsSync(envFile) && existsSync(example)) {
    copyFileSync(example, envFile);
    console.log('[avvio] creato .env da .env.example');
  }
  const dotenv = await import('dotenv');
  dotenv.config({ path: envFile });
  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT non valida.');
  const stateDir = process.env.STATE_DIR ?? 'state';
  mkdirSync(resolve(cwd, stateDir), { recursive: true });
  return { port, stateDir };
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
async function haRisposto(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/meta`, {
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
async function main(): Promise<void> {
  const { port: PORT, stateDir: STATE_DIR } = await prepareEnvironment();
  const APPENA_AGGIORNATO = process.env.HOUSE_FINDER_UPDATED === '1';
  const URL_LOCALE = `http://localhost:${PORT}`;
  // Questi moduli leggono variabili d'ambiente all'importazione: .env deve già essere caricato.
  const [{ ListingStore }, { createApp }, { startTray, trayRequested },
    { teeConsoleToFile }, { readLock }, { APP_VERSION }] = await Promise.all([
    import('../src/core/store.js'), import('../src/server/app.js'), import('../src/server/tray.js'),
    import('../src/server/logfile.js'), import('../src/update/lock.js'), import('../src/version.js'),
  ]);
  teeConsoleToFile(STATE_DIR);

  const lock = readLock(STATE_DIR);
  if (!APPENA_AGGIORNATO && lock !== null && !lock.stale) {
    console.warn('[avvio] aggiornamento in corso: non parto, riprova fra un minuto.');
    return;
  }

  if (await haRisposto(PORT)) {
    console.log(`[avvio] House Finder è già in ascolto su ${URL_LOCALE}: apro quello.`);
    apriBrowser(URL_LOCALE);
    return;
  }
  let store: Awaited<ReturnType<typeof ListingStore.load>>;
  try {
    store = await ListingStore.load(undefined, { exclusive: true });
  } catch (e) {
    // Due doppi click quasi simultanei possono precedere il bind della prima istanza.
    if (e instanceof Error && /Archivio già in uso/.test(e.message)) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (await haRisposto(PORT)) { apriBrowser(URL_LOCALE); return; }
      }
    }
    throw e;
  }
  let server: ReturnType<typeof app.listen> | null = null;
  let tray: { stop: () => void } | null = null;
  let spegnimentoInCorso = false;
  let httpChiuso = false;

  const spegni = (): void => {
    if (spegnimentoInCorso) return;
    spegnimentoInCorso = true;
    console.log('[server] spengo.');
    tray?.stop();
    // Il writer resta proprietario finché la run salva. Anche l'uscita forzata per SSE aperte
    // si arma soltanto dopo la run: l'updater può annullarsi se il padre impiega troppo tempo.
    let attesaConnessioni = false;
    const finisciQuandoLibero = (): void => {
      if (app.locals.isRunRunning?.()) {
        setTimeout(finisciQuandoLibero, 250);
        return;
      }
      if (httpChiuso) { store.close(); process.exit(0); }
      if (!attesaConnessioni) {
        attesaConnessioni = true;
        const ghigliottina = setTimeout(() => process.exit(0), 3000);
        ghigliottina.unref();
      }
    };
    server?.close(() => { httpChiuso = true; finisciQuandoLibero(); });
    finisciQuandoLibero();
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
    if (await haRisposto(PORT)) {
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
