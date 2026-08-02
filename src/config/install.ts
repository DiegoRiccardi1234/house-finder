import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dove siamo installati, e se siamo dentro il bundle Windows.
 *
 * Serve all'aggiornamento: la cartella da sostituire non si può ricavare da un `../..` fisso,
 * perché la profondità cambia fra sorgente e bundle. In dev questo file è
 * `src/config/install.ts` (radice due livelli sopra); nel bundle è `app/src/config/install.js`
 * (radice TRE livelli sopra, perché `tsc` conserva `src/` sotto `app/`). Invece di contare i
 * livelli si sale finché non si riconosce la cartella.
 *
 * Il segno del bundle è `node.exe`: è il file che `build-bundle.mjs` mette nella radice, ed è
 * anche l'unico file davvero bloccato da Windows mentre l'app gira — quindi è la cosa che
 * l'aggiornatore deve poter indicare con precisione.
 */
export interface InstallInfo {
  /** `true` dentro il bundle Windows scaricabile, `false` quando si gira dai sorgenti. */
  frozen: boolean;
  /** La cartella che un aggiornamento sostituisce (radice del bundle, o del repo in dev). */
  root: string;
  /** Il `node.exe` spedito nel bundle. `null` fuori dal bundle. */
  nodeExe: string | null;
}

const MAX_LEVELS = 8;

/** `DATA_DIR`-style override per i test: evita di dover fabbricare un finto albero profondo. */
export function detectInstall(from = dirname(fileURLToPath(import.meta.url))): InstallInfo {
  const override = process.env.INSTALL_ROOT;
  if (override) {
    const nodeExe = join(override, 'node.exe');
    const frozen = existsSync(nodeExe);
    return { frozen, root: resolve(override), nodeExe: frozen ? nodeExe : null };
  }

  let dir = resolve(from);
  let devRoot: string | null = null;

  for (let i = 0; i < MAX_LEVELS; i++) {
    const nodeExe = join(dir, 'node.exe');
    // Il bundle vince sempre: ha sia node.exe sia un package.json, e in quel caso la radice
    // dell'aggiornamento è la sua, non quella del manifest.
    if (existsSync(nodeExe) && existsSync(join(dir, 'app'))) {
      return { frozen: true, root: dir, nodeExe };
    }
    if (devRoot === null && existsSync(join(dir, 'package.json'))) devRoot = dir;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { frozen: false, root: devRoot ?? resolve(from), nodeExe: null };
}

/**
 * Quello che l'aggiornamento NON deve toccare, in path relativi alla radice.
 *
 * `state/` è l'archivio (annunci, miniature, sessione Facebook, log). `.env` sono i segreti.
 * **`app/data/local/` è la trappola**: `src/config/paths.ts` risolve la cartella dati come
 * `../../data/` rispetto al modulo, quindi nel bundle la config personale finisce DENTRO `app/`,
 * cioè esattamente dentro la cartella che l'aggiornamento riscrive. Nei due progetti Python
 * l'equivalente stava in cima e la whitelist di un solo livello bastava; qui no.
 */
export const PRESERVE: readonly string[] = ['state', '.env', '.env.local', 'app/data/local'];

/** `true` se `rel` (separatori `/` o `\`) cade dentro un percorso protetto. */
export function isPreserved(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  return PRESERVE.some((p) => norm === p || norm.startsWith(`${p}/`));
}
