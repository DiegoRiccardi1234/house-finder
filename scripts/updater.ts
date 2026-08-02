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
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isWritable, isDir, syncInstallDir } from '../src/update/sync.js';
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

interface Args {
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
  if (!root || !zip || !state || !temp || !parentPid) return null;
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
    } catch {
      return true;
    }
    await sleep(250);
  }
  return false;
}

/** La verifica onesta che il lock è caduto: si prova ad aprire il file in scrittura. */
async function attendiSbloccoNodeExe(root: string): Promise<void> {
  const exe = join(root, 'node.exe');
  const scadenza = Date.now() + UNLOCK_TIMEOUT_MS;
  while (Date.now() < scadenza) {
    if (await isWritable(exe)) return;
    await sleep(500);
  }
  // Scaduto: si prova lo stesso, e sarà la copia con i suoi tentativi a dire quale file è bloccato.
}

function estrai(zip: string, dest: string): void {
  try {
    execFileSync('tar', ['-xf', zip, '-C', dest], { stdio: 'ignore', windowsHide: true });
  } catch {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${zip}' -DestinationPath '${dest}' -Force`,
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
function riavvia(root: string, args: string[] = []): void {
  const child = spawn(join(root, 'node.exe'), [join(root, 'app', 'scripts', 'serve.js'), ...args], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, HOUSE_FINDER_UPDATED: '1' },
  });
  child.unref();
}

/** Si cancella la propria cartella temporanea, ma solo dopo essere uscito. */
function autopulizia(temp: string): void {
  try {
    spawn('cmd', ['/c', `timeout /t 6 /nobreak >nul & rmdir /s /q "${temp}"`], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    }).unref();
  } catch {
    // Resterà a Storage Sense: è un fastidio, non un guasto.
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    spiegaSeLanciatoAMano();
    return 2;
  }

  const stopHeartbeat = startHeartbeat(args.state, args.version);
  const estratti = join(args.temp, 'estratti');

  try {
    writeEvent(args.state, { step: 'replace', pct: 70, detail: 'attendo la chiusura dell\'app' });
    await attendiPadre(args.parentPid);
    await sleep(RESPIRO_MS);
    await attendiSbloccoNodeExe(args.root);

    await mkdir(estratti, { recursive: true });
    estrai(args.zip, estratti);
    const sorgente = await radice(estratti);

    writeEvent(args.state, { step: 'replace', pct: 78, detail: 'sostituisco i file' });
    const esito = await syncInstallDir(sorgente, args.root, { currentExe: process.execPath });
    writeEvent(args.state, {
      step: 'replace',
      pct: 90,
      detail: `${esito.written} file aggiornati`,
    });

    writeEvent(args.state, { step: 'restart', pct: 95, detail: 'riavvio House Finder' });
    riavvia(args.root, args.relaunch);

    writeEvent(args.state, { step: 'done', pct: 100, detail: `aggiornato alla ${args.version}` });
    stopHeartbeat();
    releaseLock(args.state);
    await rm(args.zip, { force: true }).catch(() => {});
    autopulizia(args.temp);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeEvent(args.state, { step: 'error', pct: 0, detail: msg });
    stopHeartbeat();
    releaseLock(args.state);
    // Meglio un'app che riparte di una macchina rimasta senza niente: Job e Trip Finder qui si
    // fermano, e chi ha subìto il guasto resta con l'installazione spenta e nessun indizio.
    try {
      riavvia(args.root, args.relaunch);
    } catch {
      /* se non riparte, il diario dice perché */
    }
    autopulizia(args.temp);
    return 1;
  }
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
