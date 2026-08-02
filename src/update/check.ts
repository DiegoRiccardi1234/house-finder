import { APP_VERSION, BUNDLE_ASSET, GITHUB_REPO } from '../version.js';
import { detectInstall } from '../config/install.js';

/**
 * "C'è una versione nuova?" — la parte che parla con GitHub.
 *
 * Non solleva mai: un controllo aggiornamenti che rompe la pagina è peggio di un controllo che
 * non risponde. In caso di rete assente, 404 (repo privato o nessuna release) o JSON storto si
 * torna `checked: false` e l'app va avanti.
 */

/**
 * L'unico appiglio previsto per provare l'aggiornamento davvero.
 *
 * `npm run try:update` fa girare l'app vera, con il suo `node.exe` vero e il suo riavvio vero,
 * puntandola a un finto feed servito in locale. È finto solo l'annuncio della release — tutto il
 * resto è la cosa autentica, ed è deliberato: in Trip Finder quattro difetti su cinque erano stati
 * "corretti" contro un processo finto, e il quinto stava proprio nella parte sostituita.
 */
const RELEASES_URL =
  process.env.HOUSE_FINDER_RELEASES_URL ??
  `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
const NOTES_MAX = 4000;

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  /** `sha256:...` quando l'API lo pubblica. Serve a rendere vera la verifica del download. */
  digest: string | null;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  notes: string;
  asset: ReleaseAsset | null;
  /** `false` se GitHub non ha risposto: la UI deve dirlo, non fingere "sei aggiornato". */
  checked: boolean;
  /** `false` fuori dal bundle: dai sorgenti si aggiorna con `git pull`. */
  frozen: boolean;
  /** Il motivo, quando c'è una release nuova ma non è installabile. */
  detail: string | null;
}

/**
 * `v0.10.2` → `[0, 10, 2]`.
 *
 * Il suffisso di pre-release si taglia (`1.3.0-rc1` → `1.3.0`) e il confronto è **numerico**:
 * fatto sulle stringhe direbbe che `0.9 > 0.10`, che è il modo più silenzioso di non aggiornare
 * mai più dopo la decima patch.
 */
export function parseVersion(tag: string): number[] {
  const cleaned = tag.trim().replace(/^v/i, '').split('-')[0] ?? '';
  const parts = cleaned.match(/\d+/g);
  return parts ? parts.map(Number) : [0];
}

/** `a > b` confrontando componente per componente, con i mancanti a zero. */
export function isNewer(a: string, b: string): boolean {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const da = va[i] ?? 0;
    const db = vb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

interface GhAsset {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
}
interface GhRelease {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  assets?: unknown;
}

let cache: { at: number; release: GhRelease | null } | null = null;

async function fetchLatest(force: boolean): Promise<{ release: GhRelease | null; checked: boolean }> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { release: cache.release, checked: cache.release !== null };
  }
  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `HouseFinder/${APP_VERSION}`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 404 = nessuna release, o repo privato. Non è un errore da urlare a ogni avvio.
      cache = { at: Date.now(), release: null };
      return { release: null, checked: false };
    }
    const release = (await res.json()) as GhRelease;
    cache = { at: Date.now(), release };
    return { release, checked: true };
  } catch {
    cache = { at: Date.now(), release: null };
    return { release: null, checked: false };
  }
}

/** Svuota la cache: la usano i test e il pulsante "Controlla ora". */
export function resetCheckCache(): void {
  cache = null;
}

function pickAsset(release: GhRelease): ReleaseAsset | null {
  const assets = Array.isArray(release.assets) ? (release.assets as GhAsset[]) : [];
  const hit = assets.find((a) => typeof a.name === 'string' && a.name === BUNDLE_ASSET);
  if (!hit || typeof hit.browser_download_url !== 'string') return null;
  return {
    name: BUNDLE_ASSET,
    size: typeof hit.size === 'number' ? hit.size : 0,
    url: hit.browser_download_url,
    digest: typeof hit.digest === 'string' ? hit.digest : null,
  };
}

export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<UpdateInfo> {
  const { frozen } = detectInstall();
  const base: UpdateInfo = {
    current: APP_VERSION,
    latest: null,
    updateAvailable: false,
    releaseUrl: null,
    notes: '',
    asset: null,
    checked: false,
    frozen,
    detail: null,
  };

  const { release, checked } = await fetchLatest(opts.force === true);
  if (!release || typeof release.tag_name !== 'string') return { ...base, checked };

  const latest = release.tag_name;
  const releaseUrl = typeof release.html_url === 'string' ? release.html_url : null;
  const notes = typeof release.body === 'string' ? release.body.slice(0, NOTES_MAX) : '';
  const asset = pickAsset(release);

  // Serve `latest > current`, non `latest !== current`: con una build locale più avanti
  // dell'ultima release, "diverso" vorrebbe dire retrocedere, e il pulsante "Aggiorna" farebbe
  // un downgrade dicendo di aggiornare.
  const newer = isNewer(latest, APP_VERSION);
  let detail: string | null = null;
  let updateAvailable = newer;

  if (newer && !asset) {
    updateAvailable = false;
    detail = `La release ${latest} non ha l'allegato ${BUNDLE_ASSET}: scaricala dalla pagina della release.`;
  } else if (newer && !frozen) {
    updateAvailable = false;
    detail = `C'è la ${latest}, ma questa è un'installazione dai sorgenti: aggiorna con \`git pull\`.`;
  }

  return { ...base, latest, updateAvailable, releaseUrl, notes, asset, checked, detail };
}
