import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { UPDATER_FILES } from '../src/update/install.js';
import { runUpdate, waitForVersion, type Args, type UpdateRuntime } from '../scripts/updater.js';
import { syncInstallDir } from '../src/update/sync.js';
import { lastEvent } from '../src/update/events.js';

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

async function transactionScenario() {
  const base = await mkdtemp(join(tmpdir(), 'hf-transaction-'));
  const root = join(base, 'installato');
  const source = join(base, 'nuovo');
  const temp = join(base, 'temp');
  const files: Record<string, string> = {
    'app/node.exe': 'new-node', 'app/package.json': '{"type":"module"}',
    'app/scripts/serve.js': 'new-serve', 'app/scripts/updater.js': 'new-updater',
    'app/src/version.js': "export const APP_VERSION = '2.0.0';",
    'app/ui/dist/index.html': 'new-ui', 'app/node_modules/express/package.json': '{}',
    'app/data/local/profile.json': 'MALICIOUS-EXAMPLE', 'state/listings.json': 'EXAMPLE',
    '.env': 'EXAMPLE', 'app/new-file.js': 'new-only',
  };
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(dirname(join(source, name)), { recursive: true });
    await writeFile(join(source, name), contents);
  }
  await cp(source, root, { recursive: true });
  await rm(join(root, 'app', 'new-file.js'));
  await writeFile(join(root, 'app', 'node.exe'), 'old-node');
  await writeFile(join(root, 'app', 'scripts', 'serve.js'), 'old-serve');
  await writeFile(join(root, 'app', 'src', 'version.js'), "export const APP_VERSION = '1.0.0';");
  await writeFile(join(root, 'app', 'data', 'local', 'profile.json'), 'MY-PROFILE');
  await writeFile(join(root, 'state', 'listings.json'), 'MY-ARCHIVE');
  await writeFile(join(root, '.env'), 'MY-SECRET');
  const args: Args = { root, zip: join(base, 'download.zip'), state: join(root, 'state'), temp,
    parentPid: 4242, version: 'v2.0.0', relaunch: ['--tray'] };
  const starts: string[] = [];
  const child = { exitCode: null, signalCode: null } as ChildProcess;
  const runtime: Partial<UpdateRuntime> = {
    waitParent: async () => true, pause: async () => {}, waitUnlocked: async () => {},
    extract: () => { execFileSync(process.execPath, ['-e', 'require("node:fs").cpSync(process.argv[1],process.argv[2],{recursive:true})', source, join(temp, 'estratti')]); },
    restart: async () => { starts.push(await readFile(join(root, 'app', 'scripts', 'serve.js'), 'utf8')); return child; },
    confirm: async () => {}, stop: async () => {}, cleanup: () => {},
  };
  return { args, source, starts, runtime, clean: () => rm(base, { recursive: true, force: true }) };
}

async function assertPersonalData(root: string) {
  assert.equal(await readFile(join(root, 'app', 'data', 'local', 'profile.json'), 'utf8'), 'MY-PROFILE');
  assert.equal(await readFile(join(root, 'state', 'listings.json'), 'utf8'), 'MY-ARCHIVE');
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'MY-SECRET');
}

test('timeout padre: non estrae, non copia e non rilancia una seconda istanza', async () => {
  const s = await transactionScenario();
  try {
    const code = await runUpdate(s.args, { ...s.runtime, waitParent: async () => false,
      extract: () => assert.fail('non deve estrarre'), sync: async () => assert.fail('non deve copiare') });
    assert.equal(code, 1);
    assert.deepEqual(s.starts, []);
    assert.equal(lastEvent(s.args.state)?.step, 'error');
    assert.equal(await readFile(join(s.args.root, 'app', 'node.exe'), 'utf8'), 'old-node');
    await assertPersonalData(s.args.root);
  } finally { await s.clean(); }
});

test('bundle incompleto o versione diversa: nessuna sostituzione', async () => {
  for (const failure of ['missing', 'wrong-version']) {
    const s = await transactionScenario();
    try {
      if (failure === 'missing') await rm(join(s.source, 'app', 'ui', 'dist', 'index.html'));
      else await writeFile(join(s.source, 'app', 'src', 'version.js'), "export const APP_VERSION = '3.0.0';");
      assert.equal(await runUpdate(s.args, { ...s.runtime, sync: async () => assert.fail('non deve copiare') }), 1);
      assert.deepEqual(s.starts, ['old-serve']);
      assert.equal(await readFile(join(s.args.root, 'app', 'node.exe'), 'utf8'), 'old-node');
      await assertPersonalData(s.args.root);
    } finally { await s.clean(); }
  }
});

test('copia parziale fallita: torna la versione precedente, rimuove solo file nuovi', async () => {
  const s = await transactionScenario();
  try {
    const code = await runUpdate(s.args, { ...s.runtime, sync: async (source, root, options) => {
      return syncInstallDir(source, root, { ...options, retryDelaysMs: [], copyFileImpl: async (from, to) => {
        if (to === join(root, 'app', 'scripts', 'serve.js')) throw new Error('copia interrotta');
        await copyFile(from, to);
      } });
    } });
    assert.equal(code, 1);
    assert.deepEqual(s.starts, ['old-serve']);
    assert.equal(await readFile(join(s.args.root, 'app', 'node.exe'), 'utf8'), 'old-node');
    await assert.rejects(readFile(join(s.args.root, 'app', 'new-file.js')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(s.args.temp, 'backup', 'app', 'data', 'local', 'profile.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(s.args.temp, 'backup', '.env')), { code: 'ENOENT' });
    await assertPersonalData(s.args.root);
    assert.match(lastEvent(s.args.state)?.detail ?? '', /Versione precedente ripristinata/);
  } finally { await s.clean(); }
});

test('server nuovo irraggiungibile: lo ferma prima del rollback e rilancia il precedente', async () => {
  const s = await transactionScenario();
  try {
    const order: string[] = [];
    const code = await runUpdate(s.args, { ...s.runtime,
      confirm: async (version) => {
        if (version === 'v2.0.0') { assert.equal(lastEvent(s.args.state)?.step, 'restart'); throw new Error('health fallita'); }
        assert.equal(version, '1.0.0');
      },
      stop: async () => { order.push('stop'); assert.equal(await readFile(join(s.args.root, 'app', 'node.exe'), 'utf8'), 'new-node'); },
      restart: async (...args) => { order.push('restart'); return s.runtime.restart!(...args); },
    });
    assert.equal(code, 1);
    assert.deepEqual(order, ['restart', 'stop', 'restart']);
    assert.deepEqual(s.starts, ['new-serve', 'old-serve']);
    assert.equal(lastEvent(s.args.state)?.step, 'error');
    await assertPersonalData(s.args.root);
  } finally { await s.clean(); }
});

test('errore spawn: rollback anche quando il processo nuovo non parte', async () => {
  const s = await transactionScenario();
  try {
    let first = true;
    assert.equal(await runUpdate(s.args, { ...s.runtime, restart: async (...args) => {
      if (first) { first = false; throw new Error('spawn fallito'); }
      return s.runtime.restart!(...args);
    } }), 1);
    assert.deepEqual(s.starts, ['old-serve']);
    await assertPersonalData(s.args.root);
  } finally { await s.clean(); }
});

test('rollback che non può fermare il nuovo processo: conserva backup per recupero', async () => {
  const s = await transactionScenario();
  try {
    let cleaned = false;
    assert.equal(await runUpdate(s.args, { ...s.runtime,
      confirm: async () => { throw new Error('health fallita'); },
      stop: async () => { throw new Error('processo ancora vivo'); },
      cleanup: () => { cleaned = true; },
    }), 1);
    assert.equal(cleaned, false);
    assert.deepEqual(s.starts, ['new-serve']);
    assert.equal(await readFile(join(s.args.temp, 'backup', 'app', 'node.exe'), 'utf8'), 'old-node');
    assert.match(lastEvent(s.args.state)?.detail ?? '', /Backup conservato/);
    await assertPersonalData(s.args.root);
  } finally { await s.clean(); }
});

test('successo soltanto dopo conferma: dati personali identici e nuovi file presenti', async () => {
  const s = await transactionScenario();
  try {
    let confirmed = false;
    const code = await runUpdate(s.args, { ...s.runtime, confirm: async (version) => {
      assert.equal(version, 'v2.0.0');
      assert.equal(lastEvent(s.args.state)?.step, 'restart');
      confirmed = true;
    } });
    assert.equal(code, 0);
    assert.equal(confirmed, true);
    assert.equal(lastEvent(s.args.state)?.step, 'done');
    assert.equal(await readFile(join(s.args.root, 'app', 'new-file.js'), 'utf8'), 'new-only');
    await assertPersonalData(s.args.root);
  } finally { await s.clean(); }
});

test('health di riavvio richiede versione esatta; una risposta vecchia non basta', async () => {
  let calls = 0;
  await waitForVersion('v2.0.0', { exitCode: null, signalCode: null }, {
    sleepImpl: async () => {},
    fetchImpl: (async () => new Response(JSON.stringify({ version: ++calls === 1 ? '1.0.0' : '2.0.0' }))) as typeof fetch,
  });
  assert.equal(calls, 2);
  await assert.rejects(waitForVersion('v2.0.0', { exitCode: 1, signalCode: null }), /chiuso durante il riavvio/);
  await assert.rejects(waitForVersion('v2.0.0', { exitCode: null, signalCode: null }, { timeoutMs: 0 }), /versione attesa/);
});

test('bootstrap bundle: crea .env da app e lo carica prima dei moduli con snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-bootstrap-'));
  try {
    await mkdir(join(dir, 'app'));
    await writeFile(join(dir, 'app', '.env.example'), 'PORT=43219\nSTATE_DIR=custom-state\nFB_STATE_PATH=custom-fb.json\nTHUMBS_DIR=custom-thumbs\n');
    const env = { ...process.env };
    for (const key of ['PORT', 'STATE_DIR', 'FB_STATE_PATH', 'THUMBS_DIR']) delete env[key];
    const script = `const {prepareEnvironment}=await import(${JSON.stringify(new URL('../scripts/serve.ts', import.meta.url).href)}); const boot=await prepareEnvironment(${JSON.stringify(dir)}); const fb=await import(${JSON.stringify(new URL('../src/config/facebook.ts', import.meta.url).href)}); const thumbs=await import(${JSON.stringify(new URL('../src/core/thumbs.ts', import.meta.url).href)}); console.log(JSON.stringify({...boot,fb:fb.FB_STATE_PATH,thumbs:thumbs.THUMBS_DIR}));`;
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: ROOT, env, encoding: 'utf8' });
    const actual = JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
    assert.deepEqual(actual, { port: 43219, stateDir: 'custom-state', fb: 'custom-fb.json', thumbs: 'custom-thumbs' });
    assert.equal(await readFile(join(dir, '.env'), 'utf8'), await readFile(join(dir, 'app', '.env.example'), 'utf8'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
