/**
 * Costruisce il bundle Windows scaricabile: dist/HouseFinder-windows.zip
 *
 * Contenuto dello zip: una cartella `HouseFinder/`, e dentro:
 *   node.exe                 build ufficiale Node per Windows x64
 *   app/                     server+CLI compilati (tsc) + ui/dist + data/ + scripts/tray.ps1
 *   node_modules/            solo dipendenze di produzione, senza browser Playwright
 *   HouseFinder.vbs          avvio normale: nessuna console, icona nell'area di notifica
 *   HouseFinder-console.bat  avvio con finestra, per vedere gli errori quando qualcosa non parte
 *   install-browsers.bat     scarica Chromium (abilita Subito/Immobiliare/Idealista/Facebook)
 *   .env.example, README.md, LICENSE
 *
 * Perché `tsc` e non un bundler: `imapflow` e `mailparser` risolvono moduli a runtime
 * (encoding di iconv-lite, ecc.). Un bundle single-file li romperebbe in modi che si vedono
 * solo in esecuzione. Compilare e spedire node_modules di produzione è più grosso ma sicuro.
 *
 * Uso: node scripts/build-bundle.mjs
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
/**
 * La cartella si chiama come l'app perché **finisce dentro lo zip con questo nome**.
 *
 * Prima si comprimeva il CONTENUTO (`-Path '<stage>\*'`) e l'archivio si apriva su undici voci
 * sparse: estratto dentro Download, le mescolava a tutto il resto. Job e Trip Finder mettono una
 * cartella sola e si estraggono dove capita senza fare danni.
 */
const STAGE = join(DIST, 'HouseFinder');
const APP = join(STAGE, 'app');
/**
 * Lo stesso percorso, relativo alla radice: è quello che si passa a `tsc`.
 *
 * Non l'assoluto: `run()` usa `shell: true` su Windows e non mette le virgolette, quindi un path
 * che contiene uno spazio — e questo progetto vive in "Script programmati" — arriva spezzato in
 * due, e `tsc` risponde «Option 'project' cannot be mixed with source files».
 */
const APP_REL = 'dist/HouseFinder/app';

/** Versione di Node spedita nello zip. Aggiornala insieme alla matrice della CI. */
const NODE_VERSION = process.env.BUNDLE_NODE_VERSION ?? '22.11.0';
const NODE_EXE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;

const run = (cmd, args, cwd = ROOT) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

const step = (msg) => console.log(`\n▶ ${msg}`);

async function main() {
  step('Pulizia dist/');
  await rm(DIST, { recursive: true, force: true });
  await mkdir(APP, { recursive: true });

  step('Compilazione TypeScript → app/');
  // `--outDir` esplicito: il `tsconfig.build.json` ne dichiara uno, e quando la cartella di stage
  // è stata rinominata i due sono andati a divergere in silenzio — `tsc` compilava nella vecchia e
  // lo zip usciva con node_modules ma senza una riga di codice nostro. Qui il percorso è uno solo.
  run('npx', ['tsc', '-p', 'tsconfig.build.json', '--outDir', APP_REL]);

  step('Build della UI');
  run('npm', ['run', 'ui:build']);
  await cp(join(ROOT, 'ui', 'dist'), join(APP, 'ui', 'dist'), { recursive: true });

  step('Copia della config di esempio');
  // Solo i file versionati: data/local/ è la config personale e non va nel bundle.
  await mkdir(join(APP, 'data'), { recursive: true });
  for (const f of ['criteria.md', 'searches.json', 'facebook.json']) {
    await cp(join(ROOT, 'data', f), join(APP, 'data', f));
  }

  // I .js emessi sono ESM: senza questo package.json Node li leggerebbe come CommonJS.
  await writeFile(join(APP, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

  step('Dipendenze di produzione (senza browser Playwright)');
  // `npm ci` pretende che package.json e lock combacino, devDependencies incluse: si copia il
  // manifest intero togliendo solo gli `scripts` (nessun hook deve girare qui) e si omette dev
  // in fase di install.
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  delete pkg.scripts;
  await writeFile(join(STAGE, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await cp(join(ROOT, 'package-lock.json'), join(STAGE, 'package-lock.json'));
  run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], STAGE);

  step(`Download di node.exe (v${NODE_VERSION})`);
  const res = await fetch(NODE_EXE_URL);
  if (!res.ok) throw new Error(`node.exe non scaricato: HTTP ${res.status} da ${NODE_EXE_URL}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(join(STAGE, 'node.exe')));

  step('Script non-TypeScript che tsc non copia');
  // `tsc` emette solo i .ts: il .ps1 della tray va portato a mano, con lo stesso percorso
  // relativo che ha nel repo (`src/server/tray.ts` lo cerca in `../../scripts/`).
  await mkdir(join(APP, 'scripts'), { recursive: true });
  await cp(join(ROOT, 'scripts', 'tray.ps1'), join(APP, 'scripts', 'tray.ps1'));

  step('Launcher e documentazione');
  // Avvio normale: nessuna finestra, icona nell'area di notifica. Da lì si apre e si esce.
  // `.vbs` è l'unico modo di lanciare un processo davvero senza console senza spedire un .exe
  // nostro; il bootstrap (`.env`, `state/`) ora lo fa `serve.ts`, così vale per tutti i launcher.
  await writeFile(
    join(STAGE, 'HouseFinder.vbs'),
    [
      'Set sh = CreateObject("WScript.Shell")',
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      'sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)',
      "sh.Run \"node.exe app\\scripts\\serve.js --tray --open\", 0, False",
      '',
    ].join('\r\n'),
  );
  // Avvio con console: serve quando qualcosa non parte e si vuole vedere l'errore subito,
  // invece di andarlo a leggere in state\logs\house-finder.log.
  await writeFile(
    join(STAGE, 'HouseFinder-console.bat'),
    [
      '@echo off',
      'cd /d "%~dp0"',
      'node.exe app\\scripts\\serve.js --open',
      'pause',
      '',
    ].join('\r\n'),
  );
  await writeFile(
    join(STAGE, 'install-browsers.bat'),
    [
      '@echo off',
      'cd /d "%~dp0"',
      'echo Scarico Chromium per gli scraper (Subito, Immobiliare, Idealista, Facebook)...',
      'node.exe node_modules\\playwright\\cli.js install chromium',
      'pause',
      '',
    ].join('\r\n'),
  );
  for (const f of ['.env.example', 'README.md', 'LICENSE']) {
    await cp(join(ROOT, f), join(STAGE, f));
  }

  step('Controllo che il pacchetto sia completo');
  // Uno zip che pesa giusto ma non contiene il codice si scopre solo quando qualcuno prova ad
  // aprirlo — cioè dopo la pubblicazione. È già successo: `tsc` compilava in una cartella e il
  // pacchetto si costruiva da un'altra. Meglio una build che fallisce di una release muta.
  for (const atteso of [
    ['node.exe'],
    ['app', 'scripts', 'serve.js'],
    ['app', 'scripts', 'updater.js'],
    ['app', 'scripts', 'tray.ps1'],
    ['app', 'src', 'version.js'],
    ['app', 'ui', 'dist', 'index.html'],
    ['node_modules', 'express', 'package.json'],
    ['HouseFinder.vbs'],
  ]) {
    const p = join(STAGE, ...atteso);
    await stat(p).catch(() => {
      throw new Error(`Pacchetto incompleto: manca ${atteso.join('/')} — build interrotta.`);
    });
  }

  step('Creazione dello zip');
  const zip = join(DIST, 'HouseFinder-windows.zip');
  // La CARTELLA, non il suo contenuto: chi estrae si ritrova un `HouseFinder\` e non undici voci
  // sparse nella cartella dei download. L'aggiornatore scarta il livello in più da sé (`radice()`
  // in `scripts/updater.ts`), quindi il cambio non rompe gli aggiornamenti già installati.
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${STAGE}' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`,
  ]);

  const { size } = await stat(zip);
  console.log(`\n✅ ${zip} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
