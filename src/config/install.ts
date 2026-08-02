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
 * Il segno del bundle è `node.exe`, ed è anche l'unico file davvero bloccato da Windows mentre
 * l'app gira — quindi è la cosa che l'aggiornatore deve poter indicare con precisione.
 *
 * **Due disposizioni, non una.** Dalla 1.5.0 `node.exe` sta in `app/`, così chi apre la cartella
 * vede solo `app\`, `HouseFinder.exe` e `LEGGIMI.txt`; fino alla 1.4.1 stava in cima. Servono
 * entrambe: un'installazione vecchia che si aggiorna passa proprio da lì, e un'installazione
 * aggiornata se li ritrova tutti e due (la sync non cancella niente), quindi la nuova va cercata
 * per prima.
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
/**
 * `node.exe` di questa installazione, se `dir` ne è la radice.
 *
 * Prima la disposizione nuova (`app/node.exe`), poi quella fino alla 1.4.1 (in cima): su
 * un'installazione aggiornata ci sono entrambi, e quello buono è il nuovo.
 */
function nodeExeIn(dir: string): string | null {
  const dentro = join(dir, 'app', 'node.exe');
  if (existsSync(dentro)) return dentro;
  const sopra = join(dir, 'node.exe');
  if (existsSync(sopra) && existsSync(join(dir, 'app'))) return sopra;
  return null;
}

export function detectInstall(from = dirname(fileURLToPath(import.meta.url))): InstallInfo {
  const override = process.env.INSTALL_ROOT;
  if (override) {
    const nodeExe = nodeExeIn(override);
    return { frozen: nodeExe !== null, root: resolve(override), nodeExe };
  }

  let dir = resolve(from);
  let devRoot: string | null = null;

  for (let i = 0; i < MAX_LEVELS; i++) {
    // Il bundle vince sempre: ha sia node.exe sia un package.json, e in quel caso la radice
    // dell'aggiornamento è la sua, non quella del manifest.
    const nodeExe = nodeExeIn(dir);
    if (nodeExe) return { frozen: true, root: dir, nodeExe };
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
