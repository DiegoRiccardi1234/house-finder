import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Scrittura atomica: scrive su `${path}.tmp` e poi `rename` sul file finale (atomico su
 * stesso volume, anche su Windows via MoveFileEx). Prima tiene una copia del buono
 * precedente in `${path}.bak` (best-effort). Così un crash a metà write NON lascia mai il
 * file finale troncato, e `readJsonResilient` può ripartire dal `.bak` se serve.
 */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await writeAtomic(path, data, false);
}

/** Il backup JSON conserva l'ultima copia leggibile anche dopo un recupero da .bak. */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeAtomic(path, JSON.stringify(data, null, 2) + '\n', true);
}

async function writeAtomic(path: string, data: string, jsonBackup: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Backup del buono precedente (se non esiste ancora, ignora).
  try {
    // Il main può essere ancora corrotto dopo readJsonResilient: non copiarlo sul backup buono.
    if (jsonBackup) JSON.parse(await readFile(path, 'utf8'));
    await copyFile(path, `${path}.bak`);
  } catch {
    /* primo salvataggio, main JSON illeggibile o backup best-effort non disponibile */
  }
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}

/**
 * Legge+parsa un JSON senza MAI azzerare in silenzio su corruzione:
 *  - file assente (ENOENT) → ritorna `emptyFallback` (caso normale al primo avvio).
 *  - file presente ma JSON corrotto → prova `${path}.bak`; se valido lo usa (log), altrimenti
 *    **rilancia** (fail-loud): meglio fermarsi che cancellare l'archivio.
 *  - altri errori I/O → rilancia (non mascherare).
 */
export async function readJsonResilient<T>(path: string, emptyFallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyFallback;
    throw e;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (parseErr) {
    try {
      const bak = await readFile(`${path}.bak`, 'utf8');
      const parsed = JSON.parse(bak) as T;
      console.error(`[atomic] ${path} corrotto → ripristinato da ${path}.bak`);
      return parsed;
    } catch {
      throw new Error(
        `Archivio corrotto e nessun backup valido: ${path} (${(parseErr as Error).message}). ` +
          `Il file NON è stato cancellato: ispezionalo a mano.`,
      );
    }
  }
}
