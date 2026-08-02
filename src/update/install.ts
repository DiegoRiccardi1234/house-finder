import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { detectInstall } from '../config/install.js';
import type { ReleaseAsset } from './check.js';
import { writeEvent } from './events.js';

const run = promisify(execFile);

/**
 * Il lato app dell'aggiornamento: scarica, verifica, prepara l'aggiornatore e gli passa la mano.
 *
 * L'app scarica da sé (come Trip Finder, e a differenza di Job Finder dove lo fa l'aggiornatore):
 * chi scarica può contare i byte, quindi la barra dice la verità invece di fingere.
 */

/**
 * I file che l'aggiornatore si porta nel temporaneo, con i percorsi **relativi a `app/`**.
 *
 * È la lista che sostituisce il `_internal/` di PyInstaller. Là il bootloader cercava
 * `python311.dll` accanto all'eseguibile *prima* che Python partisse: copiando il solo `.exe`
 * moriva con "Failed to load Python DLL" senza lasciare traccia nemmeno nel log. Qui il rischio è
 * lo stesso in miniatura — un `import` di troppo e l'aggiornatore non parte — ed è per questo che
 * `test/update-updater.test.ts` verifica che il grafo di import di `scripts/updater.ts` non esca
 * mai da questa lista.
 */
export const UPDATER_FILES: readonly string[] = [
  'package.json',
  'scripts/updater.js',
  'src/config/install.js',
  'src/update/events.js',
  'src/update/lock.js',
  'src/update/sync.js',
];

export interface StagedUpdate {
  tempDir: string;
  zipPath: string;
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** Elenca le voci dello zip. `tar.exe` c'è su Windows 10+ e legge gli zip. */
async function listZip(zip: string): Promise<string[]> {
  try {
    const { stdout } = await run('tar', ['-tf', zip], { maxBuffer: 32 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[IO.Compression.ZipFile]::OpenRead('${zip}').Entries | ForEach-Object { $_.FullName }`;
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', ps], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.split(/\r?\n/).filter(Boolean);
  }
}

/**
 * Scarica l'asset segnalando l'avanzamento in byte.
 */
export async function downloadAsset(
  asset: ReleaseAsset,
  dest: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(asset.url, {
    headers: { 'User-Agent': 'HouseFinder', Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) throw new Error(`Download fallito: HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length') ?? asset.size ?? 0);
  let received = 0;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onProgress(received, total);
  });
  await pipeline(body, createWriteStream(dest));
}

/**
 * Controlla che il file scaricato sia davvero il bundle annunciato.
 *
 * In Job e Trip Finder il passo "verifica" racchiude soltanto `extractall`: non verifica niente,
 * e il nome mente all'utente. Qui si guarda la dimensione, l'impronta sha256 quando l'API la
 * pubblica, e la presenza in archivio dei due file senza i quali il bundle non è un bundle.
 * Se qualcosa non torna si annulla **prima** di aver toccato un solo file dell'installazione.
 */
export async function verifyDownload(zipPath: string, asset: ReleaseAsset): Promise<void> {
  const { size } = await stat(zipPath);
  if (asset.size > 0 && size !== asset.size) {
    throw new Error(`Download incompleto: ${size} byte invece di ${asset.size}.`);
  }
  if (asset.digest?.startsWith('sha256:')) {
    const expected = asset.digest.slice('sha256:'.length).toLowerCase();
    const actual = await sha256(zipPath);
    if (actual !== expected) {
      throw new Error(`Impronta sha256 diversa da quella dichiarata da GitHub.`);
    }
  }
  const entries = (await listZip(zipPath)).map((e) => e.replace(/\\/g, '/').replace(/^\.\//, ''));
  // Lo zip contiene una cartella `HouseFinder/`, come quelli di Job e Trip Finder: estratto dove
  // capita non sparpaglia undici voci addosso a chi lo apre. Fino alla 1.4.0 era senza, e le due
  // forme vanno accettate entrambe — un'installazione vecchia deve poter aggiornare a una nuova.
  const has = (p: string) => entries.some((e) => e === p || e.endsWith(`/${p}`));
  for (const needed of ['node.exe', 'app/scripts/serve.js']) {
    if (!has(needed)) throw new Error(`L'archivio non contiene ${needed}: non è un bundle valido.`);
  }
}

/**
 * Mette l'aggiornatore in una cartella temporanea, con la stessa forma che ha dentro `app/`.
 *
 * Deve girare da fuori: l'unico file che Windows blocca davvero mentre l'app gira è `node.exe`,
 * ed è proprio quello che l'aggiornamento deve sostituire.
 */
export async function stageUpdater(installRoot: string, nodeExe: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), `house-finder-updater-${process.pid}-`));
  const appDir = join(installRoot, 'app');
  for (const rel of UPDATER_FILES) {
    const to = join(tempDir, rel);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(appDir, rel), to);
  }
  await copyFile(nodeExe, join(tempDir, 'node.exe'));
  return tempDir;
}

export interface LaunchOptions {
  installRoot: string;
  zipPath: string;
  tempDir: string;
  stateDir: string;
  version: string;
  /**
   * Come riaccendere l'app.
   *
   * Senza questo, chi aveva avviato dal launcher del bundle si ritrovava dopo l'aggiornamento un
   * server acceso e **nessuna icona nella tray**: niente da cliccare per riaprirlo, niente per
   * spegnerlo. Il riavvio deve ricreare le condizioni di partenza, non quelle di default.
   */
  relaunchArgs: string[];
}

/**
 * Lancia l'aggiornatore e gli lascia il campo.
 *
 * `stdio: 'ignore'` non è pignoleria. In Job Finder il processo rilanciato ereditava handle di
 * standard output non validi e moriva alla prima riga scritta, prima ancora di aprire la porta:
 * da fuori sembrava che l'aggiornamento non finisse mai. `'ignore'` fa aprire `NUL` a Node
 * invece di ereditare qualcosa di morto, ed è l'antidoto esatto a quel difetto.
 */
export function launchUpdater(opts: LaunchOptions): number | undefined {
  const child = spawn(
    join(opts.tempDir, 'node.exe'),
    [
      join(opts.tempDir, 'scripts', 'updater.js'),
      '--root', opts.installRoot,
      '--zip', opts.zipPath,
      '--state', opts.stateDir,
      '--temp', opts.tempDir,
      '--parent-pid', String(process.pid),
      '--version', opts.version,
      // Sempre per ultimo: quello che segue sono gli argomenti con cui riavviare l'app.
      '--relaunch', ...opts.relaunchArgs,
    ],
    { detached: true, windowsHide: true, stdio: 'ignore' },
  );
  child.unref();
  return child.pid;
}

/** Il percorso dove si scarica il bundle nuovo. */
export function downloadPath(stateDir: string, version: string): string {
  return join(stateDir, 'updates', `HouseFinder-${version}.zip`);
}

/** Butta via i bundle scaricati da aggiornamenti precedenti. */
export async function cleanDownloads(stateDir: string): Promise<void> {
  await rm(join(stateDir, 'updates'), { recursive: true, force: true }).catch(() => {});
}

/** Scorciatoia leggibile per gli handler: dove siamo installati e con quale `node.exe`. */
export function installInfo(): ReturnType<typeof detectInstall> {
  return detectInstall();
}

export { writeEvent };
