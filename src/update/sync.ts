import { copyFile, mkdir, open, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isPreserved } from '../config/install.js';

/**
 * Riversa i file della nuova versione sopra l'installazione.
 *
 * Tre regole, ognuna pagata da un incidente vero su Job/Trip Finder:
 *
 * 1. **Riprova sui file bloccati, per una trentina di secondi.** Windows Defender pre-scansiona
 *    l'archivio appena scompattato e ne tiene gli handle per 10-20 secondi. Con la scala di
 *    attese `1,2,4` l'aggiornamento falliva **sempre esattamente 7 secondi dopo l'inizio della
 *    copia** — la somma. Con `1,2,4,8,16` si arriva a ~31 s e l'antivirus ha finito.
 * 2. **L'errore finale dice QUALE file è rimasto bloccato.** È l'unica informazione che
 *    distingue "antivirus" da "bug", e senza di essa l'utente vede solo una barra ferma.
 * 3. **Non cancella niente.** Un file di troppo non ha mai rotto niente; uno mancante sì.
 *
 * `isPreserved` protegge archivio, segreti e config personale — compreso `app/data/local`, che
 * qui sta *dentro* la cartella riscritta e nei due progetti Python non aveva un equivalente.
 */

export const COPY_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const;

/** Codici Windows di "file occupato": vale la pena riprovare solo su questi. */
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES', 'ETXTBSY']);

export interface SyncOptions {
  /** Iniettabile nei test per non aspettare mezzo minuto davvero. */
  retryDelaysMs?: readonly number[];
  /** L'eseguibile in uso: non si riscrive mai addosso. */
  currentExe?: string | null;
  sleep?: (ms: number) => Promise<void>;
  onFile?: (rel: string) => void;
  /**
   * La copia vera e propria, iniettabile.
   *
   * Serve ai test per simulare un file tenuto aperto dall'antivirus: un namespace ESM non si
   * può rattoppare dall'esterno, quindi il punto di innesto va previsto qui.
   */
  copyFileImpl?: (from: string, to: string) => Promise<void>;
}

export interface SyncResult {
  written: number;
  skipped: string[];
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function copyWithRetry(
  from: string,
  to: string,
  delays: readonly number[],
  sleep: (ms: number) => Promise<void>,
  copy: (from: string, to: string) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await copy(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!BUSY.has(code) || attempt >= delays.length) {
        throw new Error(
          `Non riesco a scrivere ${to} (${code || 'errore sconosciuto'}). ` +
            `Il file è tenuto aperto da un altro programma — di solito l'antivirus o una copia ` +
            `dell'app ancora accesa.`,
          { cause: e },
        );
      }
      await sleep(delays[attempt] ?? 0);
    }
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Copia `src` sopra `dest`. Torna quanti file ha scritto e quali ha saltato di proposito.
 */
export async function syncInstallDir(
  src: string,
  dest: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const delays = opts.retryDelaysMs ?? COPY_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? wait;
  const copy = opts.copyFileImpl ?? copyFile;
  const currentExe = opts.currentExe ? resolve(opts.currentExe).toLowerCase() : null;

  const result: SyncResult = { written: 0, skipped: [] };

  for await (const file of walk(src)) {
    const rel = relative(src, file).split(sep).join('/');
    if (isPreserved(rel)) {
      result.skipped.push(rel);
      continue;
    }
    const target = join(dest, rel);
    // Cintura e bretelle: chi lancia l'aggiornatore ne mette una copia nel temporaneo proprio
    // perché l'eseguibile installato resti libero. Se quella copia non riuscisse, non si deve
    // comunque provare a riscrivere sé stessi mentre si è in esecuzione.
    if (currentExe && resolve(target).toLowerCase() === currentExe) {
      result.skipped.push(rel);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await copyWithRetry(file, target, delays, sleep, copy);
    result.written++;
    opts.onFile?.(rel);
  }

  return result;
}

/** Il file esiste ed è apribile in scrittura? È la domanda vera su "il lock è caduto". */
export async function isWritable(file: string): Promise<boolean> {
  try {
    const fh = await open(file, 'r+');
    await fh.close();
    return true;
  } catch {
    return false;
  }
}

/** `true` se il percorso esiste ed è una cartella. */
export async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
