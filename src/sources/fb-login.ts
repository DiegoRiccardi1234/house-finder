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

export const LOGIN_TIMEOUT_MS = 10 * 60_000;

/**
 * Pagine in cui Facebook sta ancora chiedendo qualcosa: verifica dispositivo, codice 2FA, conferma
 * identità. Il cookie `c_user` compare GIÀ qui, prima che la verifica sia completata: salvare la
 * sessione a questo punto la lascia a metà, e al giro dopo Facebook richiede tutto da capo.
 */
const PAGINE_IN_VERIFICA = /\/(checkpoint|login|two_step_verification|two_factor|auth_platform|recover|confirmemail|device-based)/i;

/** Accesso davvero concluso: cookie di sessione presente e nessuna pagina di verifica aperta. */
export function loginComplete(loggedIn: boolean, urls: string[]): boolean {
  return loggedIn && urls.length > 0 && urls.every((url) => !PAGINE_IN_VERIFICA.test(url));
}

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
    browser = await launchBrowser({ preferInstalled: true });
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
    let conferme = 0;
    let avvisato = false;
    while (Date.now() < scadenza) {
      const urls = ctx.pages().filter((p) => !p.isClosed()).map((p) => p.url());
      const loggato = await isLoggedIn(ctx);
      if (loginComplete(loggato, urls)) {
        // Due controlli di fila: Facebook passa per redirect intermedi prima della pagina finale.
        if (++conferme >= 2) { ok = true; break; }
      } else {
        conferme = 0;
        if (loggato && !avvisato) {
          avvisato = true;
          log('Facebook chiede una verifica: completala nella finestra, aspetto che finisca.');
        }
      }
      if (!browser.isConnected() || urls.length === 0) {
        throw new Error('Finestra del browser chiusa prima di completare l\'accesso. Riprova.');
      }
      // Non `page.waitForTimeout`: se la verifica si apre in un'altra scheda e chiudi la prima, lancerebbe.
      await new Promise((resolve) => setTimeout(resolve, 2000));
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
