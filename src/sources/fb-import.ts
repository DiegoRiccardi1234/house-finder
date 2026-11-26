import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import { FB_STATE_PATH } from '../config/facebook.js';
import { writeFbState } from './fb-session.js';

/**
 * Sessione Facebook presa da un browser in cui la persona è GIÀ dentro: niente login, niente
 * verifica. Il browser di tutti i giorni è un dispositivo che Facebook conosce già; la finestra
 * dell'app all'inizio no.
 *
 * Famiglia Chromium (Brave, Edge, Vivaldi, Opera): si apre il profilo vero con lo stesso programma
 * che l'ha creato, così i cookie li decifra lui. Va chiuso prima: col browser aperto il profilo è
 * bloccato. Firefox: si legge una copia del suo database dei cookie, senza aprirlo.
 *
 * Chrome no: dalla 136 ignora l'automazione sul profilo principale e cifra i cookie legandoli al
 * proprio eseguibile (app-bound encryption). Si mostra, ma con l'invito ad "Accedi da qui".
 * Salva soltanto i cookie di Facebook.
 */

export type FbBrowserId = 'brave' | 'edge' | 'vivaldi' | 'opera' | 'firefox' | 'chrome';

export interface FbBrowser {
  id: FbBrowserId;
  label: string;
  /** Programma e profilo trovati su questo computer. */
  available: boolean;
  /** Si può prendere la sessione da qui (Chrome: no, per scelta di Chrome). */
  importable: boolean;
  note?: string;
}

interface ChromiumPaths { kind: 'chromium'; exe: string; userData: string; profile: string | null }
interface FirefoxPaths { kind: 'firefox'; exe: string; profileDir: string | null }
type BrowserPaths = ChromiumPaths | FirefoxPaths;

interface BrowserDef {
  id: FbBrowserId;
  label: string;
  importable: boolean;
  note?: string;
  paths: (env: NodeJS.ProcessEnv) => BrowserPaths;
}

const firstExisting = (cands: string[]): string => cands.find((p) => p && existsSync(p)) ?? cands[0] ?? '';

function dirs(env: NodeJS.ProcessEnv) {
  return {
    local: env.LOCALAPPDATA ?? '',
    roaming: env.APPDATA ?? '',
    pf: env.ProgramFiles ?? 'C:\\Program Files',
    pf86: env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  };
}

/**
 * Opera installa un lanciatore (`opera.exe`) che avvia la versione vera da una sottocartella ed
 * esce: aperto da Playwright sembrerebbe un browser chiuso subito. Si cerca la versione più alta.
 */
export function operaExe(installDir: string): string {
  try {
    const versions = readdirSync(installDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+(\.\d+)*$/.test(d.name) && existsSync(join(installDir, d.name, 'opera.exe')))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (versions[0]) return join(installDir, versions[0], 'opera.exe');
  } catch { /* cartella assente */ }
  return join(installDir, 'opera.exe');
}

/** Profilo predefinito di Firefox, da `profiles.ini`: prima la sezione [Install…], poi Default=1. */
export function firefoxDefaultProfile(firefoxDir: string): string | null {
  let ini: string;
  try { ini = readFileSync(join(firefoxDir, 'profiles.ini'), 'utf8'); } catch { return null; }
  const sections: Array<{ name: string; kv: Record<string, string> }> = [];
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { sections.push({ name: sec[1]!, kv: {} }); continue; }
    const eq = line.indexOf('=');
    if (eq > 0 && sections.length) sections[sections.length - 1]!.kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const resolvePath = (p: string, relative: boolean) => (relative || !isAbsolute(p) ? join(firefoxDir, p) : p);
  // Firefox recente scrive il profilo "vero" in [Install<hash>]: Default=1 nei [Profile] può essere vecchio.
  const install = sections.find((s) => s.name.startsWith('Install') && s.kv.Default);
  if (install) return resolvePath(install.kv.Default!, true);
  const profiles = sections.filter((s) => s.name.startsWith('Profile') && s.kv.Path);
  const def = profiles.find((s) => s.kv.Default === '1') ?? profiles[0];
  return def ? resolvePath(def.kv.Path!, def.kv.IsRelative !== '0') : null;
}

const BROWSERS: BrowserDef[] = [
  {
    id: 'brave', label: 'Brave', importable: true,
    paths: (env) => {
      const d = dirs(env);
      return {
        kind: 'chromium',
        userData: env.BRAVE_USER_DATA ?? join(d.local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
        exe: env.BRAVE_EXE ?? firstExisting([
          join(d.pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          join(d.local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        ]),
        profile: env.BRAVE_PROFILE ?? 'Default',
      };
    },
  },
  {
    id: 'edge', label: 'Microsoft Edge', importable: true,
    note: 'Edge resta spesso acceso in sottofondo: chiudilo anche dall\'area di notifica.',
    paths: (env) => {
      const d = dirs(env);
      return {
        kind: 'chromium',
        userData: env.EDGE_USER_DATA ?? join(d.local, 'Microsoft', 'Edge', 'User Data'),
        exe: env.EDGE_EXE ?? firstExisting([
          join(d.pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(d.pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]),
        profile: env.EDGE_PROFILE ?? 'Default',
      };
    },
  },
  {
    id: 'vivaldi', label: 'Vivaldi', importable: true,
    paths: (env) => {
      const d = dirs(env);
      return {
        kind: 'chromium',
        userData: env.VIVALDI_USER_DATA ?? join(d.local, 'Vivaldi', 'User Data'),
        exe: env.VIVALDI_EXE ?? firstExisting([
          join(d.local, 'Vivaldi', 'Application', 'vivaldi.exe'),
          join(d.pf, 'Vivaldi', 'Application', 'vivaldi.exe'),
        ]),
        profile: env.VIVALDI_PROFILE ?? 'Default',
      };
    },
  },
  {
    id: 'opera', label: 'Opera', importable: true,
    paths: (env) => {
      const d = dirs(env);
      // In Opera la cartella dati È il profilo: niente --profile-directory.
      return {
        kind: 'chromium',
        userData: env.OPERA_USER_DATA ?? join(d.roaming, 'Opera Software', 'Opera Stable'),
        exe: env.OPERA_EXE ?? operaExe(join(d.local, 'Programs', 'Opera')),
        profile: null,
      };
    },
  },
  {
    id: 'firefox', label: 'Firefox', importable: true,
    paths: (env) => {
      const d = dirs(env);
      const ffDir = env.FIREFOX_DIR ?? join(d.roaming, 'Mozilla', 'Firefox');
      return {
        kind: 'firefox',
        exe: env.FIREFOX_EXE ?? firstExisting([
          join(d.pf, 'Mozilla Firefox', 'firefox.exe'),
          join(d.pf86, 'Mozilla Firefox', 'firefox.exe'),
        ]),
        profileDir: env.FIREFOX_PROFILE_DIR ?? firefoxDefaultProfile(ffDir),
      };
    },
  },
  {
    id: 'chrome', label: 'Google Chrome', importable: false,
    note: 'Chrome non permette ad altri programmi di leggere la sessione. Usa "Accedi da qui": la verifica di Facebook si fa una volta sola.',
    paths: (env) => {
      const d = dirs(env);
      return {
        kind: 'chromium',
        userData: env.CHROME_USER_DATA ?? join(d.local, 'Google', 'Chrome', 'User Data'),
        exe: env.CHROME_EXE ?? firstExisting([
          join(d.pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(d.pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(d.local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]),
        profile: env.CHROME_PROFILE ?? 'Default',
      };
    },
  },
];

function pathsAvailable(p: BrowserPaths): boolean {
  if (!p.exe || !existsSync(p.exe)) return false;
  if (p.kind === 'firefox') return !!p.profileDir && existsSync(join(p.profileDir, 'cookies.sqlite'));
  return existsSync(p.profile ? join(p.userData, p.profile) : p.userData);
}

/** I browser che l'app conosce, con cosa ha trovato su questo computer. */
export function listFbBrowsers(env: NodeJS.ProcessEnv = process.env): FbBrowser[] {
  return BROWSERS.map((b) => ({
    id: b.id,
    label: b.label,
    available: pathsAvailable(b.paths(env)),
    importable: b.importable,
    ...(b.note ? { note: b.note } : {}),
  }));
}

export function isFbBrowserId(v: unknown): v is FbBrowserId {
  return typeof v === 'string' && BROWSERS.some((b) => b.id === v);
}

type PersistentLaunch = (userDataDir: string, opts: Parameters<typeof chromium.launchPersistentContext>[1]) => Promise<BrowserContext>;

export interface ImportOptions {
  statePath?: string;
  env?: NodeJS.ProcessEnv;
  /** Solo per i test: sostituisce l'apertura del browser (nessun browser vero nei test). */
  launch?: PersistentLaunch;
}

const chiudiErr = (label: string) =>
  new Error(`Non riesco ad aprire il profilo di ${label}: chiudi ${label} del tutto (anche dall'area di notifica) e riprova. Se non basta, usa "Accedi da qui".`);
const fuoriErr = (label: string) =>
  new Error(`In ${label} non risulti dentro Facebook: accedi a facebook.com da ${label}, chiudilo e riprova.`);

/** Prende la sessione dal browser indicato e la salva per le scansioni. Torna l'id dell'account. */
export async function importFacebookFrom(
  id: FbBrowserId,
  log: (line: string) => void,
  opts: ImportOptions = {},
): Promise<string> {
  const def = BROWSERS.find((b) => b.id === id);
  if (!def) throw new Error('Browser sconosciuto.');
  if (!def.importable) throw new Error(def.note ?? `Da ${def.label} non si può prendere la sessione.`);
  const env = opts.env ?? process.env;
  const statePath = opts.statePath ?? FB_STATE_PATH;
  const paths = def.paths(env);
  if (!pathsAvailable(paths)) throw new Error(`${def.label} non trovato su questo computer.`);

  log(`Leggo la sessione di Facebook da ${def.label}…`);
  const cookies = paths.kind === 'firefox'
    ? await readFirefoxCookies(paths.profileDir!, def.label)
    : await readChromiumState(paths, def.label, opts.launch);

  const cUser = cookies.cookies.find((c) => c.name === 'c_user' && !!c.value);
  if (!cUser) throw fuoriErr(def.label);
  const n = await writeFbState(statePath, cookies);
  log(`Sessione salvata (${n} cookie).`);
  return cUser.value;
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

async function readChromiumState(paths: ChromiumPaths, label: string, launch?: PersistentLaunch): Promise<StorageState> {
  const open = launch ?? ((dir, o) => chromium.launchPersistentContext(dir, o));
  let ctx: BrowserContext;
  try {
    ctx = await open(paths.userData, {
      executablePath: paths.exe,
      headless: true,
      timeout: 45_000,
      args: paths.profile ? [`--profile-directory=${paths.profile}`] : [],
    });
  } catch {
    // In pratica quasi sempre: profilo bloccato da un browser ancora aperto (anche solo nell'area di notifica).
    throw chiudiErr(label);
  }
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // Visitare la pagina fa caricare al browser i cookie del sito: senza, alcuni restano su disco.
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);
    return await ctx.storageState();
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** sameSite di Firefox: 0/1/2 = None/Lax/Strict. Il resto (es. "non impostato") vale come Lax. */
export function firefoxSameSite(v: unknown, secure: boolean): 'None' | 'Lax' | 'Strict' {
  const n = Number(v);
  // None senza Secure i browser lo rifiutano: meglio Lax che un cookie scartato in silenzio.
  if (n === 0) return secure ? 'None' : 'Lax';
  if (n === 2) return 'Strict';
  return 'Lax';
}

/** Firefox ha scritto la scadenza in secondi per anni, poi in millisecondi: si accettano entrambe. */
export function firefoxExpiry(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return -1;
  return n > 1e11 ? Math.floor(n / 1000) : n;
}

interface MozCookieRow {
  name: string; value: string; host: string; path: string;
  expiry: number | bigint; isSecure: number | bigint; isHttpOnly: number | bigint; sameSite: number | bigint;
}

/**
 * Legge i cookie di Facebook dal profilo Firefox, da una COPIA del database: il file vero lo tiene
 * aperto Firefox e non va mai toccato. Si copiano anche `-wal`/`-shm`, dove stanno le modifiche
 * recenti non ancora riversate nel file principale.
 */
export async function readFirefoxCookies(profileDir: string, label = 'Firefox'): Promise<StorageState> {
  let sqlite: typeof import('node:sqlite');
  try {
    sqlite = await import('node:sqlite');
  } catch {
    throw new Error('Questa versione di Node non sa leggere i dati di Firefox (serve Node 22.13 o più recente). Usa "Accedi da qui".');
  }
  const tmp = mkdtempSync(join(tmpdir(), 'hf-ff-'));
  try {
    try {
      copyFileSync(join(profileDir, 'cookies.sqlite'), join(tmp, 'cookies.sqlite'));
      for (const ext of ['-wal', '-shm']) {
        const src = join(profileDir, `cookies.sqlite${ext}`);
        if (existsSync(src)) copyFileSync(src, join(tmp, `cookies.sqlite${ext}`));
      }
    } catch {
      // Firefox aperto blocca una parte del file: su Windows la copia fallisce.
      throw chiudiErr(label);
    }
    // Non readOnly: con il -wal accanto SQLite deve poterlo riversare, e la copia è nostra.
    const db = new sqlite.DatabaseSync(join(tmp, 'cookies.sqlite'));
    let rows: MozCookieRow[];
    try {
      rows = db.prepare(
        "SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies " +
          "WHERE host LIKE '%facebook.com' AND originAttributes = ''",
      ).all() as unknown as MozCookieRow[];
    } catch {
      throw new Error(`Non riesco a leggere i dati di ${label}: forse è una versione che l'app non conosce. Usa "Accedi da qui".`);
    } finally {
      db.close();
    }
    const cookies = rows
      .filter((r) => /(^|\.)facebook\.com$/.test(String(r.host).replace(/^\./, '')))
      .map((r) => {
        const secure = Number(r.isSecure) === 1;
        return {
          name: String(r.name),
          value: String(r.value),
          domain: String(r.host),
          path: String(r.path || '/'),
          expires: firefoxExpiry(r.expiry),
          httpOnly: Number(r.isHttpOnly) === 1,
          secure,
          sameSite: firefoxSameSite(r.sameSite, secure),
        };
      });
    return { cookies, origins: [] };
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  }
}

// --- Compatibilità: `fb:from-brave` e il vecchio endpoint ---------------------------------------

export interface BravePaths { userData: string; exe: string; profile: string }

export function bravePaths(env: NodeJS.ProcessEnv = process.env): BravePaths {
  const p = BROWSERS.find((b) => b.id === 'brave')!.paths(env) as ChromiumPaths;
  return { userData: p.userData, exe: p.exe, profile: p.profile ?? 'Default' };
}

/** Brave installato con un profilo: decide se mostrare il pulsante. */
export function braveAvailable(paths: BravePaths = bravePaths()): boolean {
  return existsSync(paths.exe) && existsSync(join(paths.userData, paths.profile));
}

export async function importFacebookFromBrave(
  log: (line: string) => void,
  opts: { statePath?: string; paths?: BravePaths; launch?: PersistentLaunch } = {},
): Promise<string> {
  const env = opts.paths
    ? { ...process.env, BRAVE_USER_DATA: opts.paths.userData, BRAVE_EXE: opts.paths.exe, BRAVE_PROFILE: opts.paths.profile }
    : process.env;
  return importFacebookFrom('brave', log, { statePath: opts.statePath, env, launch: opts.launch });
}
