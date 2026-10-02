/**
 * L'aggiornatore: gira DA FUORI l'installazione, mentre l'app è spenta.
 *
 * Perché un processo a parte: Windows tiene un lock esclusivo su un eseguibile in esecuzione, e
 * nessun numero di tentativi glielo fa mollare. `node.exe` è l'unico file del bundle in quella
 * condizione — tutto il resto sono `.js` in chiaro — quindi basta che a copiarlo sia qualcun
 * altro, con una copia di `node.exe` presa in prestito nel `%TEMP%`.
 *
 * Vincolo da rispettare a ogni modifica: **qui dentro si importa solo da `node:*` e dai file
 * elencati in `UPDATER_FILES`**. Un import di troppo e l'aggiornatore non parte, perché nel
 * temporaneo `node_modules` non c'è. È la versione in miniatura del "Failed to load Python DLL"
 * che ha bloccato Job Finder per due release, e `test/update-updater.test.ts` la sorveglia.
 *
 * Non si lancia a mano: lo lancia l'app quando si preme "Aggiorna ora".
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { isWritable, isDir, syncInstallDir, snapshotInstall, restoreInstall,
  validateBundleTree, validateArchiveEntries, type InstallSnapshot } from '../src/update/sync.js';
import { releaseLock, startHeartbeat } from '../src/update/lock.js';
import { writeEvent } from '../src/update/events.js';

/** Quanto si aspetta che il processo padre esca prima di rinunciare. */
const PARENT_TIMEOUT_MS = 60_000;
/**
 * Il respiro dopo che il padre è uscito.
 *
 * Non è superstizione: nel log reale di Trip Finder il processo esce alle 23:25:53 e il
 * `PermissionError` arriva alle 23:25:56. Windows impiega qualche secondo a rilasciare gli
 * handle ereditati, e l'antivirus ci mette del suo.
 */
const RESPIRO_MS = 3_000;
/** Quanto si insiste sul `node.exe` ancora bloccato prima di provarci lo stesso. */
const UNLOCK_TIMEOUT_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface Args {
  root: string;
  zip: string;
  state: string;
  temp: string;
  parentPid: number;
  version: string;
  /** Con cosa riavviare l'app: `--tray` se l'icona c'era, così l'aggiornamento non la fa sparire. */
  relaunch: string[];
}

export function parseArgs(argv: string[]): Args | null {
  const iRelaunch = argv.indexOf('--relaunch');
  const testa = iRelaunch >= 0 ? argv.slice(0, iRelaunch) : argv;
  const relaunch = iRelaunch >= 0 ? argv.slice(iRelaunch + 1) : [];
  const get = (name: string): string | undefined => {
    const i = testa.indexOf(`--${name}`);
    return i >= 0 ? testa[i + 1] : undefined;
  };
  const root = get('root');
  const zip = get('zip');
  const state = get('state');
  const temp = get('temp');
  const parentPid = Number(get('parent-pid') ?? '0');
  const version = get('version') ?? '';
  if (!root || !zip || !state || !temp || !Number.isInteger(parentPid) || parentPid <= 0 || !version) return null;
  return { root, zip, state, temp, parentPid, version, relaunch };
}

/**
 * Chi ci fa doppio click merita una spiegazione, non un errore muto.
 *
 * Senza questo, l'aggiornatore lanciato a mano moriva su un argomento mancante dentro una
 * finestra che si chiudeva da sola: dall'esterno, un file che "non fa niente".
 */
function spiegaSeLanciatoAMano(): void {
  const msg =
    'Questo programma non va lanciato a mano: lo avvia House Finder quando premi ' +
    '"Aggiorna ora" nella scheda Config.';
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${msg}','House Finder')`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
  } catch {
    // Niente PowerShell: pazienza, l'importante è non uscire con uno stack trace.
  }
}

/**
 * Aspetta che il processo padre sia uscito.
 *
 * In Node `process.kill(pid, 0)` è davvero una domanda — a differenza di Python su Windows, dove
 * `os.kill(pid, 0)` viene tradotto in `TerminateProcess` e quindi ammazza quello che stava
 * controllando (Trip Finder ci ha perso una release). Resta però una risposta ottimista: dice
 * "esiste" anche mentre gli handle sono ancora in chiusura. Per questo dopo c'è il respiro, e
 * soprattutto c'è la domanda che conta davvero: `node.exe` è scrivibile?
 */
async function attendiPadre(pid: number): Promise<boolean> {
  const scadenza = Date.now() + PARENT_TIMEOUT_MS;
  while (Date.now() < scadenza) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw e;
    }
    await sleep(250);
  }
  return false;
}

/** La verifica onesta che il lock è caduto: si prova ad aprire il file in scrittura. */
async function attendiSbloccoNodeExe(root: string): Promise<void> {
  // Prima della sostituzione: è il `node.exe` che l'app in chiusura stava usando, ed è quello il
  // cui lock deve cadere.
  const exe = nodeDaUsare(root);
  const scadenza = Date.now() + UNLOCK_TIMEOUT_MS;
  while (Date.now() < scadenza) {
    if (await isWritable(exe)) return;
    await sleep(500);
  }
  // Scaduto: si prova lo stesso, e sarà la copia con i suoi tentativi a dire quale file è bloccato.
}

function estrai(zip: string, dest: string): void {
  let entries: string[];
  try {
    entries = execFileSync('tar', ['-tf', zip], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true }).split(/\r?\n/).filter(Boolean);
  } catch {
    const escaped = zip.replace(/'/g, "''");
    const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${escaped}'); try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }`;
    entries = execFileSync('powershell', ['-NoProfile', '-Command', command],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean);
  }
  validateArchiveEntries(entries);
  try {
    execFileSync('tar', ['-xf', zip, '-C', dest], { stdio: 'ignore', windowsHide: true });
  } catch {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
  }
}

/**
 * La radice vera dei file estratti.
 *
 * Dalla 1.4.1 lo zip contiene una cartella `HouseFinder/` e va scartato quel livello; fino alla
 * 1.4.0 aveva i file in cima. Servono entrambe le forme, e non per pignoleria: un'installazione
 * vecchia che si aggiorna a una nuova incontra proprio il passaggio fra le due, e copiare una
 * cartella dentro l'installazione invece del suo contenuto sarebbe un disastro silenzioso.
 */
async function radice(dir: string): Promise<string> {
  const voci = await readdir(dir, { withFileTypes: true });
  if (voci.length === 1 && voci[0]?.isDirectory()) {
    const dentro = join(dir, voci[0].name);
    if (await isDir(join(dentro, 'app'))) return dentro;
  }
  return dir;
}

/**
 * Riaccende l'app.
 *
 * `HOUSE_FINDER_UPDATED=1` serve a due cose: saltare la guardia del lucchetto all'avvio (che
 * altrimenti vedrebbe un lucchetto ancora fresco e si rifiuterebbe di partire), e non aprire una
 * seconda scheda del browser — quella aperta si sta già ricaricando da sola.
 */
/**
 * Dove sta `node.exe` **dopo** la sostituzione dei file.
 *
 * Si guarda adesso e non prima: la disposizione che conta è quella appena installata. Dalla 1.5.0
 * `node.exe` vive in `app/`; fino alla 1.4.1 stava in cima, e su un'installazione aggiornata ci
 * sono entrambi perché la sync non cancella mai. Riavviare con quello vecchio funzionerebbe per
 * caso — ed è esattamente il genere di cosa che regge finché non regge più.
 */
function nodeDaUsare(root: string): string {
  const dentro = join(root, 'app', 'node.exe');
  return existsSync(dentro) ? dentro : join(root, 'node.exe');
}

async function riavvia(root: string, args: string[] = []): Promise<ChildProcess> {
  const child = spawn(nodeDaUsare(root), [join(root, 'app', 'scripts', 'serve.js'), ...args], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, HOUSE_FINDER_UPDATED: '1' },
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return child;
}

/** Si cancella la propria cartella temporanea, ma solo dopo essere uscito. */
function autopulizia(temp: string): void {
  try {
    const target = resolve(temp);
    const allowed = join(resolve(tmpdir()), 'house-finder-updater-').toLowerCase();
    if (!target.toLowerCase().startsWith(allowed) || target.slice(allowed.length).includes(sep)) return;
    const escaped = target.replace(/'/g, "''");
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      `Start-Sleep -Seconds 6; Remove-Item -LiteralPath '${escaped}' -Recurse -Force`], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    }).unref();
  } catch {
    // Resterà a Storage Sense: è un fastidio, non un guasto.
  }
}

export async function waitForVersion(version: string, child: Pick<ChildProcess, 'exitCode' | 'signalCode'>,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> } = {}): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Il programma si è chiuso durante il riavvio.');
    try {
      const response = await (opts.fetchImpl ?? fetch)(`http://127.0.0.1:${process.env.PORT ?? '3000'}/api/meta`, {
        signal: AbortSignal.timeout(1500),
      });
      const body = response.ok ? await response.json() as { version?: string } : null;
      if (body?.version?.replace(/^v/, '') === version.replace(/^v/, '')) return;
    } catch { /* il server sta ancora partendo */ }
    await (opts.sleepImpl ?? sleep)(500);
  }
  throw new Error(`Il programma non risponde con la versione attesa ${version}.`);
}

async function stopRelaunched(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Il programma nuovo non si è spento: ripristino rinviato.')), 10_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

export interface UpdateRuntime {
  waitParent: (pid: number) => Promise<boolean>;
  pause: (ms: number) => Promise<void>;
  waitUnlocked: (root: string) => Promise<void>;
  extract: (zip: string, dest: string) => void;
  restart: (root: string, args: string[]) => Promise<ChildProcess>;
  confirm: (version: string, child: ChildProcess) => Promise<void>;
  stop: (child: ChildProcess) => Promise<void>;
  sync: typeof syncInstallDir;
  cleanup: (temp: string) => void;
}

/** Testabile su cartelle temporanee, senza avviare processi o scaricare release. */
export async function runUpdate(args: Args, overrides: Partial<UpdateRuntime> = {}): Promise<number> {
  const runtime: UpdateRuntime = { waitParent: attendiPadre, pause: sleep, waitUnlocked: attendiSbloccoNodeExe,
    extract: estrai, restart: riavvia, confirm: waitForVersion, stop: stopRelaunched,
    sync: syncInstallDir, cleanup: autopulizia, ...overrides };
  const stopHeartbeat = startHeartbeat(args.state, args.version);
  const estratti = join(args.temp, 'estratti');
  let parentExited = false;
  let snapshot: InstallSnapshot | null = null;
  let relaunched: ChildProcess | null = null;
  let replacementStarted = false;
  let keepBackup = false;
  let previousVersion: string | undefined;
  try {
    writeEvent(args.state, { step: 'replace', pct: 70, detail: 'attendo la chiusura dell\'app' });
    parentExited = await runtime.waitParent(args.parentPid);
    if (!parentExited) throw new Error('L\'app non si è chiusa entro il timeout: aggiornamento annullato.');
    await runtime.pause(RESPIRO_MS);
    await runtime.waitUnlocked(args.root);
    await mkdir(estratti, { recursive: true });
    runtime.extract(args.zip, estratti);
    const source = await radice(estratti);
    await validateBundleTree(source, args.version);
    previousVersion = (await readFile(join(args.root, 'app', 'src', 'version.js'), 'utf8'))
      .match(/export\s+const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if (!previousVersion) throw new Error('Non riconosco la versione installata: aggiornamento annullato.');
    snapshot = await snapshotInstall(source, args.root, join(args.temp, 'backup'));
    writeEvent(args.state, { step: 'replace', pct: 78, detail: 'sostituisco i file' });
    replacementStarted = true;
    const result = await runtime.sync(source, args.root, { currentExe: process.execPath });
    writeEvent(args.state, { step: 'replace', pct: 90, detail: `${result.written} file aggiornati` });
    writeEvent(args.state, { step: 'restart', pct: 95, detail: 'riavvio e verifico la versione' });
    relaunched = await runtime.restart(args.root, args.relaunch);
    await runtime.confirm(args.version, relaunched);
    writeEvent(args.state, { step: 'done', pct: 100, detail: `aggiornato alla ${args.version}` });
    await rm(args.zip, { force: true }).catch(() => {});
    return 0;
  } catch (e) {
    let detail = e instanceof Error ? e.message : String(e);
    try {
      if (relaunched) await runtime.stop(relaunched);
      if (replacementStarted && snapshot) {
        await restoreInstall(snapshot);
        detail += ' Versione precedente ripristinata.';
      }
      if (parentExited) {
        const previous = await runtime.restart(args.root, args.relaunch);
        if (replacementStarted && previousVersion) await runtime.confirm(previousVersion, previous);
      }
    } catch (rollbackError) {
      keepBackup = replacementStarted;
      detail += ` ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`;
      if (keepBackup) detail += ` Backup conservato in ${join(args.temp, 'backup')}.`;
    }
    writeEvent(args.state, { step: 'error', pct: 0, detail });
    return 1;
  } finally {
    stopHeartbeat();
    releaseLock(args.state);
    if (!keepBackup) runtime.cleanup(args.temp);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    spiegaSeLanciatoAMano();
    return 2;
  }

  return runUpdate(args);
}

// Parte solo se lanciato, non se importato: `test/update-updater.test.ts` legge da qui, e un
// aggiornamento che si avvia da solo durante i test sarebbe un modo memorabile di rovinare
// l'installazione di chi lancia `npm test`.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/updater.js')) {
  main().then(
    (code) => process.exit(code),
    () => process.exit(1),
  );
}
