/**
 * La prova vera dell'aggiornamento, dall'inizio alla fine.
 *
 * Cosa fa:
 *   1. costruisce il bundle (o riusa `dist/HouseFinder-windows.zip` con `--reuse`);
 *   2. lo installa in una cartella temporanea, con dentro dei file-sentinella che NON devono
 *      sparire (archivio, `.env`, config personale);
 *   3. fabbrica un "bundle nuovo" partendo da quello vero, con la versione alzata e un file in
 *      più che serve a dimostrare che i file sono stati davvero sostituiti;
 *   4. serve in locale un finto feed di GitHub che annuncia quella versione;
 *   5. avvia l'app installata, chiama `POST /api/update/install` e sta a guardare.
 *
 * **È finto solo il feed.** Il processo, il `node.exe` bloccato da Windows, l'aggiornatore nel
 * `%TEMP%`, lo spegnimento e il riavvio sono quelli veri. È l'unico modo di provare questa
 * funzione che valga qualcosa: in Trip Finder quattro difetti su cinque erano stati corretti
 * usando un processo finto al posto dell'app, e il quinto stava esattamente lì.
 *
 * Uso: `npm run try:update [-- --reuse]`
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ZIP = join(ROOT, 'dist', 'HouseFinder-windows.zip');
const PORTA_APP = 3987;
const PORTA_FEED = 3988;
const VERSIONE_FINTA = '99.0.0';
const SENTINELLA = 'NON-TOCCARE-QUESTO';

const passo = (m: string): void => console.log(`\n▶ ${m}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function esiste(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Il diario dell'aggiornatore è l'unica finestra su cosa è successo: si stampa sempre. */
async function mostraDiario(install: string): Promise<void> {
  const diario = join(install, 'state', 'logs', 'updater.log');
  if (!(await esiste(diario))) {
    console.log(`\n   nessun diario in ${diario}: l'aggiornatore non è nemmeno partito.`);
    return;
  }
  console.log(`\n   diario (${diario}):`);
  const righe = (await readFile(diario, 'utf8')).trimEnd().split('\n');
  console.log(righe.slice(-10).map((l) => `     ${l}`).join('\n'));
}

function estrai(zip: string, dest: string): void {
  execFileSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' });
}

function comprimi(dir: string, zip: string): void {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${dir}\\*' -DestinationPath '${zip}' -CompressionLevel Fastest -Force`,
    ],
    { stdio: 'inherit' },
  );
}

async function versioneOra(): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORTA_APP}/api/meta`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null; // non ancora in ascolto, o già spento
  }
}

/**
 * Aspetta che a rispondere sia una versione **precisa**.
 *
 * Non "che qualcuno risponda": il server vecchio resta in piedi per un attimo dopo aver risposto
 * `202`, e chiedendo subito si ottiene la versione vecchia e si conclude che l'aggiornamento è
 * fallito quando invece non è ancora iniziato. È lo stesso errore che in Job Finder fa aspettare
 * cinque minuti a chi ha la macchina veloce — e l'ho rifatto qui alla prima passata.
 */
async function attendiVersione(attesa: string | null, timeoutMs: number): Promise<string | null> {
  const scadenza = Date.now() + timeoutMs;
  let ultima: string | null = null;
  while (Date.now() < scadenza) {
    const v = await versioneOra();
    if (v) ultima = v;
    if (attesa === null ? v !== null : v === attesa) return v;
    await sleep(700);
  }
  return attesa === null ? null : ultima;
}

async function main(): Promise<void> {
  const reuse = process.argv.includes('--reuse');

  if (!reuse || !(await esiste(ZIP))) {
    passo('Costruisco il bundle (qualche minuto: npm ci + download di node.exe)');
    execFileSync('node', ['scripts/build-bundle.mjs'], { cwd: ROOT, stdio: 'inherit' });
  } else {
    passo('Riuso il bundle già in dist/');
  }

  const base = await mkdtemp(join(tmpdir(), 'hf-e2e-'));
  const install = join(base, 'installato');
  const nuovo = join(base, 'nuovo');
  const zipNuovo = join(base, 'HouseFinder-windows.zip');
  await mkdir(install, { recursive: true });
  await mkdir(nuovo, { recursive: true });

  passo(`Installo la versione attuale in ${install}`);
  estrai(ZIP, install);

  // I file che l'aggiornamento NON deve toccare.
  await mkdir(join(install, 'state'), { recursive: true });
  await mkdir(join(install, 'app', 'data', 'local'), { recursive: true });
  await writeFile(join(install, 'state', 'listings.json'), `["${SENTINELLA}"]`);
  await writeFile(join(install, '.env'), `SEGRETO=${SENTINELLA}\n`);
  await writeFile(join(install, 'app', 'data', 'local', 'criteria.md'), SENTINELLA);

  passo(`Fabbrico il bundle "nuovo" (versione ${VERSIONE_FINTA})`);
  estrai(ZIP, nuovo);
  const versionJs = join(nuovo, 'app', 'src', 'version.js');
  const src = await readFile(versionJs, 'utf8');
  await writeFile(versionJs, src.replace(/APP_VERSION = '[^']+'/, `APP_VERSION = '${VERSIONE_FINTA}'`));
  // La prova che i file sono stati sostituiti davvero, non solo che il numero è cambiato.
  await writeFile(join(nuovo, 'PROVA-AGGIORNAMENTO.txt'), 'arrivato con la versione nuova\n');
  comprimi(nuovo, zipNuovo);
  const { size } = await stat(zipNuovo);

  passo('Avvio il finto feed di GitHub');
  const feed = createServer((req, res) => {
    if (req.url?.startsWith('/zip')) {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(size) });
      createReadStream(zipNuovo).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        tag_name: `v${VERSIONE_FINTA}`,
        html_url: 'http://127.0.0.1/finta',
        body: 'Release di prova.',
        assets: [
          {
            name: 'HouseFinder-windows.zip',
            size,
            browser_download_url: `http://127.0.0.1:${PORTA_FEED}/zip`,
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => feed.listen(PORTA_FEED, '127.0.0.1', r));

  passo("Avvio l'app installata");
  const env = {
    ...process.env,
    PORT: String(PORTA_APP),
    HOUSE_FINDER_RELEASES_URL: `http://127.0.0.1:${PORTA_FEED}/releases`,
    HOUSE_FINDER_TRAY: '',
    HOUSE_FINDER_UPDATED: '',
  };
  let app: ChildProcess | null = spawn(join(install, 'node.exe'), ['app/scripts/serve.js'], {
    cwd: install,
    env,
    stdio: 'inherit',
  });

  let esito = 1;
  try {
    const prima = await attendiVersione(null, 30_000);
    if (!prima) throw new Error("l'app non è partita");
    console.log(`   in ascolto, versione ${prima}`);

    passo('Premo "Aggiorna ora"');
    const res = await fetch(`http://127.0.0.1:${PORTA_APP}/api/update/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    console.log(`   HTTP ${res.status} ${JSON.stringify(await res.json())}`);
    if (res.status !== 202) throw new Error('aggiornamento non avviato');

    passo("Aspetto che si spenga e torni su da solo (l'app rilanciata non è più figlia nostra)");
    app = null; // da qui in poi il processo che conta è quello che rilancia l'aggiornatore
    const dopo = await attendiVersione(VERSIONE_FINTA, 300_000);
    if (dopo !== VERSIONE_FINTA) {
      mostraDiario(install);
      throw new Error(`è tornato su con la versione ${dopo ?? 'nessuna'}, attesa ${VERSIONE_FINTA}`);
    }
    console.log(`   tornato su con la ${dopo}`);

    passo('Controllo cosa è cambiato e cosa no');
    const prove: Array<[string, boolean]> = [
      ['i file nuovi sono arrivati', await esiste(join(install, 'PROVA-AGGIORNAMENTO.txt'))],
      [
        "l'archivio è intatto",
        (await readFile(join(install, 'state', 'listings.json'), 'utf8')).includes(SENTINELLA),
      ],
      ['il .env è intatto', (await readFile(join(install, '.env'), 'utf8')).includes(SENTINELLA)],
      [
        'la config personale è intatta',
        (await readFile(join(install, 'app', 'data', 'local', 'criteria.md'), 'utf8')).includes(
          SENTINELLA,
        ),
      ],
      ['il lucchetto è stato restituito', !(await esiste(join(install, 'state', 'update.lock')))],
    ];
    let tutteVere = true;
    for (const [nome, ok] of prove) {
      console.log(`   ${ok ? '✅' : '❌'} ${nome}`);
      if (!ok) tutteVere = false;
    }

    await mostraDiario(install);
    esito = tutteVere ? 0 : 1;
    console.log(tutteVere ? '\n✅ Aggiornamento riuscito.' : '\n❌ Qualcosa non torna.');
  } catch (e) {
    console.error(`\n❌ ${(e as Error).message}`);
  } finally {
    passo('Pulizia');
    app?.kill();
    // L'app rilanciata dall'aggiornatore è staccata: la si spegne dalla sua stessa API.
    await fetch(`http://127.0.0.1:${PORTA_APP}/api/system/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
    await sleep(1500);
    feed.close();
    // Su fallimento la cartella resta: senza, il post-mortem è impossibile. Ed è successo.
    if (esito === 0 && !process.argv.includes('--keep')) {
      await rm(base, { recursive: true, force: true }).catch(() => {
        console.log(`   (${base} non si cancella: lo terrà Storage Sense)`);
      });
    } else {
      console.log(`   lascio tutto in ${base}`);
    }
  }
  process.exit(esito);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
