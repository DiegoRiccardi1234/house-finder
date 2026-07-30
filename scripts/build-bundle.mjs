/**
 * Costruisce il bundle Windows scaricabile: dist/HouseFinder-windows.zip
 *
 * Contenuto dello zip:
 *   node.exe                 build ufficiale Node per Windows x64
 *   app/                     server+CLI compilati (tsc) + ui/dist + data/
 *   node_modules/            solo dipendenze di produzione, senza browser Playwright
 *   HouseFinder.bat          avvia il server e apre il browser
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
const STAGE = join(DIST, 'stage');
const APP = join(STAGE, 'app');

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
  run('npx', ['tsc', '-p', 'tsconfig.build.json']);

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

  step('Launcher e documentazione');
  await writeFile(
    join(STAGE, 'HouseFinder.bat'),
    [
      '@echo off',
      'cd /d "%~dp0"',
      'if not exist ".env" copy ".env.example" ".env" >nul',
      'if not exist "state" mkdir "state"',
      'start "" cmd /c "timeout /t 3 >nul & start "" http://localhost:3000"',
      'node.exe app\\scripts\\serve.js',
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

  step('Creazione dello zip');
  const zip = join(DIST, 'HouseFinder-windows.zip');
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`,
  ]);

  const { size } = await stat(zip);
  console.log(`\n✅ ${zip} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
