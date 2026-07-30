import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Risoluzione dei file di configurazione in `data/`.
 *
 * Due livelli:
 * - `data/<file>`        — versionato, contenuti di esempio: è quello che vede chi clona il repo.
 * - `data/local/<file>`  — gitignorato, la TUA config reale. Se esiste, vince in lettura.
 *
 * La UI (`PUT /api/config/*`) scrive SEMPRE nel livello locale: così le modifiche personali
 * non finiscono mai nei file di esempio versionati.
 *
 * Risoluzione LAZY, a ogni chiamata: un `data/local/<file>` creato a runtime (dalla UI o a mano)
 * deve essere visto senza riavviare il server.
 *
 * `DATA_DIR` permette di spostare l'intera cartella dati (usata dai test).
 */
function dataDir(): string {
  return process.env.DATA_DIR ?? fileURLToPath(new URL('../../data/', import.meta.url));
}

const join = (dir: string, ...parts: string[]): string =>
  [dir.replace(/[\\/]+$/, ''), ...parts].join('/');

/** Path del file di esempio versionato: `data/<file>`. */
export function sharedConfigPath(file: string): string {
  return join(dataDir(), file);
}

/** Path della config personale: `data/local/<file>`. Sempre questo in scrittura. */
export function localConfigPath(file: string): string {
  return join(dataDir(), 'local', file);
}

/** Path da cui LEGGERE: `data/local/<file>` se esiste, altrimenti `data/<file>`. */
export function configReadPath(file: string): string {
  const local = localConfigPath(file);
  return existsSync(local) ? local : sharedConfigPath(file);
}
