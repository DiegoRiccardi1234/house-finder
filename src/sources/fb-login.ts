import { readFileSync } from 'node:fs';
import { launchBrowser, newContext } from '../core/browser.js';
import { isLoggedIn } from './fb-session.js';
import { FB_STATE_PATH } from '../config/facebook.js';

/**
 * Accesso a Facebook con un browser vero, guidato dall'utente.
 *
 * È il flusso che funziona **per chiunque**, 2FA compreso: il codice non lo indovina l'app, lo
 * digita la persona nella finestra che si è aperta. La scorciatoia `fb:from-brave` serve solo a
 * chi ha già l'account dentro Brave, e da un bundle senza terminale non era comunque avviabile.
 *
 * Vive qui e non dentro `scripts/` perché lo usano in due: il comando da riga di comando e il
 * pulsante nella UI. Duplicarlo avrebbe voluto dire correggere i bug una volta sola su due.
 */

export const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface FbSessionInfo {
  exists: boolean;
  /** L'id dell'account (cookie `c_user`): serve a far vedere *quale* account è collegato. */
  accountId: string | null;
  /** Quando scade il cookie di sessione, se lo dichiara. */
  expiresAt: string | null;
}

interface StoredCookie {
  name?: unknown;
  value?: unknown;
  expires?: unknown;
}

/** Legge lo stato salvato senza aprire un browser: la usa `/api/facebook/session`. */
export function readSession(path: string = FB_STATE_PATH): FbSessionInfo {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { cookies?: StoredCookie[] };
    const cookies = Array.isArray(raw.cookies) ? raw.cookies : [];
    const cUser = cookies.find((c) => c.name === 'c_user' && typeof c.value === 'string');
    if (!cUser) return { exists: false, accountId: null, expiresAt: null };
    const exp = typeof cUser.expires === 'number' && cUser.expires > 0 ? cUser.expires : null;
    return {
      exists: true,
      accountId: String(cUser.value),
      expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
    };
  } catch {
    return { exists: false, accountId: null, expiresAt: null };
  }
}

/**
 * Apre la pagina di accesso e aspetta che l'utente entri, poi salva la sessione.
 *
 * Torna l'id dell'account. Lancia se il login non arriva entro `timeoutMs`, o se il browser non
 * si apre affatto — che in pratica vuol dire "Chromium non è installato", ed è un messaggio da
 * dire chiaro perché ha un pulsante che lo risolve.
 */
export async function loginToFacebook(
  log: (line: string) => void,
  opts: { timeoutMs?: number; statePath?: string } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const statePath = opts.statePath ?? FB_STATE_PATH;

  log('Apro una finestra del browser…');
  let browser;
  try {
    browser = await launchBrowser();
  } catch (e) {
    throw new Error(
      `Non riesco ad aprire il browser: ${(e as Error).message}. ` +
        'Se non li hai ancora installati, usa "Installa i browser" in Config → App.',
    );
  }

  try {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });
    log('Accedi nella finestra che si è aperta. Se hai il codice a due fattori, inseriscilo lì.');
    log(`Aspetto fino a ${Math.round(timeoutMs / 60_000)} minuti.`);

    const scadenza = Date.now() + timeoutMs;
    let ok = false;
    while (Date.now() < scadenza) {
      if (await isLoggedIn(ctx)) {
        ok = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
    if (!ok) {
      throw new Error('Tempo scaduto: non ho rilevato l\'accesso. Riprova.');
    }

    await ctx.storageState({ path: statePath });
    const info = readSession(statePath);
    log('Sessione salvata.');
    return info.accountId ?? '';
  } finally {
    await browser.close().catch(() => {});
  }
}
