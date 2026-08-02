import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, posix, relative, resolve } from 'node:path';
import { UPDATER_FILES } from '../src/update/install.js';

/**
 * Il guardiano del vincolo più fragile dell'aggiornamento.
 *
 * L'aggiornatore gira dal `%TEMP%`, dove `node_modules` non c'è e ci sono solo i file elencati in
 * `UPDATER_FILES`. Un `import` in più e non parte — e siccome muore prima di poter scrivere una
 * riga, non lascia traccia nemmeno nel diario: da fuori si vede solo un aggiornamento che non
 * finisce mai. È esattamente il "Failed to load Python DLL" che ha tenuto Job Finder fermo due
 * release, tradotto in Node.
 *
 * Questo test cammina il grafo di import a partire da `scripts/updater.ts` e pretende che ogni
 * dipendenza sia `node:*` oppure un file già nel bagaglio.
 */

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

const toPosix = (p: string): string => relative(ROOT, p).split(/[\\/]/).join('/');
/** `src/update/sync.ts` → `src/update/sync.js`, la forma con cui il file viaggia nel temporaneo. */
const compiled = (rel: string): string => rel.replace(/\.ts$/, '.js');

test('l\'aggiornatore non importa niente che non si porti dietro', async () => {
  const start = 'scripts/updater.ts';
  const visti = new Set<string>();
  const coda = [start];
  const bagaglio = new Set(UPDATER_FILES);

  while (coda.length) {
    const rel = coda.pop() as string;
    if (visti.has(rel)) continue;
    visti.add(rel);

    assert.ok(
      bagaglio.has(compiled(rel)),
      `${rel} serve all'aggiornatore ma non è in UPDATER_FILES: nel temporaneo non ci arriverebbe`,
    );

    const src = await readFile(resolve(ROOT, rel), 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? '';
      if (spec.startsWith('node:')) continue;
      assert.ok(
        spec.startsWith('.'),
        `${rel} importa "${spec}": nel temporaneo non c'è node_modules, quindi l'aggiornatore non partirebbe`,
      );
      const abs = resolve(dirname(resolve(ROOT, rel)), spec);
      coda.push(toPosix(abs).replace(/\.js$/, '.ts'));
    }
  }

  // E il contrario: un file nel bagaglio che nessuno importa è peso morto da togliere.
  const usati = new Set([...visti].map(compiled));
  for (const f of UPDATER_FILES) {
    if (f === 'package.json') continue; // serve a Node per leggere i .js come ESM, non si importa
    assert.ok(usati.has(f), `${f} è in UPDATER_FILES ma nessuno lo importa`);
  }
});

test('nel bagaglio c\'è il package.json: senza, Node legge i .js come CommonJS', () => {
  assert.ok(UPDATER_FILES.includes('package.json'));
  assert.ok(UPDATER_FILES.includes('scripts/updater.js'));
});

test('il riavvio ricrea le condizioni di partenza, tray compresa', async () => {
  const { parseArgs } = await import('../scripts/updater.js');
  const args = parseArgs([
    '--root', 'C:\\HF',
    '--zip', 'C:\\HF\\state\\updates\\x.zip',
    '--state', 'state',
    '--temp', 'C:\\Temp\\hf',
    '--parent-pid', '4242',
    '--version', 'v1.3.0',
    '--relaunch', '--tray',
  ]);
  assert.ok(args);
  assert.equal(args.parentPid, 4242);
  // Senza questo, chi era partito dal launcher del bundle si ritrova dopo l'aggiornamento un
  // server acceso e nessuna icona: niente da cliccare per riaprirlo, niente per spegnerlo.
  assert.deepEqual(args.relaunch, ['--tray']);
  // `--open` non deve esserci: la scheda del browser è già aperta e si sta ricaricando da sola.
  assert.ok(!args.relaunch.includes('--open'));
});

test('senza argomenti non fa niente: chi ci fa doppio click merita una spiegazione', async () => {
  const { parseArgs } = await import('../scripts/updater.js');
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['--root', 'C:\\HF']), null, 'argomenti a metà = non si parte');
});

test('i percorsi del bagaglio sono relativi ad app/ e in forma posix', () => {
  for (const f of UPDATER_FILES) {
    assert.equal(f, posix.normalize(f), `${f} non è normalizzato`);
    assert.ok(!f.startsWith('/') && !f.includes('\\'), `${f} deve essere relativo e con /`);
  }
});
