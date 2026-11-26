import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BrowserContext } from 'playwright';
import { FB_STATE_PATH } from '../config/facebook.js';
import { writeFileAtomic } from '../core/atomic.js';

/**
 * Loggato su Facebook? Controlla il cookie `c_user` (id utente), presente solo a sessione valida.
 * Usato da fb-login (attesa login) e fb-run (abort se sessione scaduta).
 */
export async function isLoggedIn(ctx: BrowserContext): Promise<boolean> {
  const cookies = await ctx.cookies('https://www.facebook.com');
  return cookies.some((c) => c.name === 'c_user' && !!c.value);
}

/**
 * Profilo del browser dedicato all'app (`state/fb-browser-profile/`).
 *
 * Esiste perché un profilo nuovo a ogni accesso è, per Facebook, un dispositivo mai visto: chiede
 * la verifica ogni volta. Tenendo lo stesso profilo la verifica si fa una volta sola e poi
 * Facebook "si ricorda di questo computer" (cookie `datr`), per gli accessi e per le scansioni.
 */
export function fbProfileDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.FB_PROFILE_DIR ?? join(dirname(env.FB_STATE_PATH ?? FB_STATE_PATH), 'fb-browser-profile');
}

/**
 * Lucchetto in memoria sul profilo: Chromium non apre due volte la stessa cartella, e se ci prova
 * il secondo processo passa la palla al primo e muore. Meglio saperlo prima e dirlo chiaro.
 * Copre lo stesso processo (server); un `fb:run` da terminale si riconosce dall'errore di avvio.
 */
const profiliInUso = new Set<string>();

export function claimProfile(dir: string): (() => void) | null {
  const key = resolve(dir).toLowerCase();
  if (profiliInUso.has(key)) return null;
  profiliInUso.add(key);
  let rilasciato = false;
  return () => {
    if (rilasciato) return;
    rilasciato = true;
    profiliInUso.delete(key);
  };
}

export function profileInUse(dir: string): boolean {
  return profiliInUso.has(resolve(dir).toLowerCase());
}

const FB_COOKIE = /(^|\.)(facebook\.com|fbcdn\.net|fbsbx\.com)$/;

interface StateLike {
  cookies: Array<{ name: string; value: string; domain: string }>;
  origins?: Array<{ origin: string }>;
}

/** Solo Facebook: nel file non devono finire cookie di altri siti, anche se il profilo li ha. */
export function facebookOnly<T extends StateLike>(state: T): { cookies: T['cookies']; origins: NonNullable<T['origins']> } {
  const cookies = state.cookies.filter((c) => FB_COOKIE.test(c.domain.replace(/^\./, '')));
  const origins = (state.origins ?? []).filter((o) => /facebook\.com/.test(o.origin)) as NonNullable<T['origins']>;
  return { cookies, origins };
}

/** Scrive la sessione in modo atomico: un crash a metà non deve lasciare un file troncato. */
export async function writeFbState(statePath: string, state: StateLike): Promise<number> {
  const { cookies, origins } = facebookOnly(state);
  await writeFileAtomic(statePath, JSON.stringify({ cookies, origins }, null, 2));
  return cookies.length;
}

/** Esporta la sessione dal browser aperto verso il file che usano le scansioni. */
export async function saveFbState(ctx: BrowserContext, statePath: string = FB_STATE_PATH): Promise<number> {
  return writeFbState(statePath, await ctx.storageState());
}

type PwCookie = Parameters<BrowserContext['addCookies']>[0][number];

/**
 * Allinea il profilo dell'app alla sessione salvata nel file.
 *
 * Il file decide *quale account* usare (può arrivare da un import da Brave o Firefox), il profilo
 * porta il dispositivo riconosciuto e i cookie più freschi. Se il profilo è già dentro con lo
 * stesso account non si tocca niente — i suoi cookie sono più recenti di quelli del file.
 * Torna true se ha dovuto copiare i cookie del file nel profilo.
 */
export async function alignProfileWithState(ctx: BrowserContext, statePath: string = FB_STATE_PATH): Promise<boolean> {
  let fileCookies: PwCookie[];
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as { cookies?: PwCookie[] };
    fileCookies = Array.isArray(raw.cookies) ? raw.cookies : [];
  } catch {
    return false;
  }
  const fileUser = fileCookies.find((c) => c.name === 'c_user')?.value;
  if (!fileUser) return false;
  const profUser = (await ctx.cookies('https://www.facebook.com')).find((c) => c.name === 'c_user')?.value;
  if (profUser === fileUser) return false;
  // Account diverso o assente: via i cookie di Facebook del profilo, dentro quelli del file.
  // `datr` del file sostituisce quello del profilo, ed è giusto: è il dispositivo da cui la
  // sessione è nata.
  await ctx.clearCookies({ domain: /facebook\.com$/ });
  await ctx.addCookies(fileCookies.filter((c) => /facebook\.com$/.test(c.domain ?? '')));
  return true;
}
