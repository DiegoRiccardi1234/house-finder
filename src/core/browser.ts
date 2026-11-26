import { chromium, type Browser, type BrowserContext } from 'playwright';

/** Browser installati da provare, in ordine, quando si vuole un browser "vero" e non Chrome for Testing. */
export const INSTALLED_CHANNELS = ['chrome', 'msedge'] as const;

/**
 * Avvia Chromium. Supporta un proxy opzionale via PROXY_URL:
 * utile se un portale blocca gli IP datacenter di GitHub Actions.
 *
 * `preferInstalled`: prova prima Chrome e poi Edge installati sul PC, e solo se mancano il Chromium
 * incorporato. Lo usa Facebook: Chrome for Testing (l'icona con la "T") è un dispositivo che
 * Facebook non conosce e gli fa chiedere la verifica a ogni accesso. Login e lettura dei gruppi
 * devono usare lo stesso browser, altrimenti la sessione salvata arriva da un dispositivo diverso.
 * `BROWSER_CHANNEL` nel `.env` vince sempre.
 */
export async function launchBrowser(opts: { preferInstalled?: boolean } = {}): Promise<Browser> {
  const proxyUrl = process.env.PROXY_URL;
  // I portali (Akamai/DataDome) bloccano il browser headless: default = HEADED.
  // HEADLESS=1 forza headless solo per debug del blocco.
  const headless = process.env.HEADLESS === '1';
  const base = {
    headless,
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  };
  const forced = process.env.BROWSER_CHANNEL;
  if (forced) return chromium.launch({ ...base, channel: forced }); // es. 'chrome' per Chrome reale
  if (opts.preferInstalled) {
    for (const channel of INSTALLED_CHANNELS) {
      try { return await chromium.launch({ ...base, channel }); } catch { /* non installato: prossimo */ }
    }
  }
  return chromium.launch(base);
}

/** Il canale manca sul PC (non "è andato storto"): solo in questo caso ha senso provare il prossimo. */
export function isMissingChannelError(e: unknown): boolean {
  return /is not found at|Executable doesn't exist/i.test((e as Error)?.message ?? '');
}

/**
 * Un altro processo tiene già aperta quella cartella profilo. Chrome in quel caso passa la mano
 * alla finestra già aperta ed esce subito, e Playwright vede solo un browser chiuso.
 */
export function isProfileInUseError(e: unknown): boolean {
  return /ProcessSingleton|SingletonLock|already in use|existing browser session|profile.*(in use|locked)|Target page, context or browser has been closed/i
    .test((e as Error)?.message ?? '');
}

const CHANNEL_MARKER = '.house-finder-channel';

type PersistentLaunch = typeof chromium.launchPersistentContext;

/**
 * Apre un profilo del browser che resta su disco (non un context usa-e-getta).
 *
 * Stessa catena di `launchBrowser({ preferInstalled })`: Chrome, Edge, poi il Chromium incorporato.
 * Si passa al canale dopo SOLO se quello prima non è installato: se Chrome c'è ma il profilo è
 * bloccato, aprirlo con Edge lo rovinerebbe (cookie cifrati da un altro programma). Il canale che
 * ha creato il profilo resta scritto lì accanto e la volta dopo si riprova per primo.
 */
export async function launchPersistentProfile(
  userDataDir: string,
  opts: { headless?: boolean; launch?: PersistentLaunch } = {},
): Promise<{ ctx: BrowserContext; channel: string | null }> {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const launch = opts.launch ?? chromium.launchPersistentContext.bind(chromium);
  const proxyUrl = process.env.PROXY_URL;
  const base = {
    headless: opts.headless ?? process.env.HEADLESS === '1',
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8' },
    // Niente userAgent forzato: qui la versione del browser non si conosce prima di aprirlo, e
    // un UA incoerente coi client hints è proprio ciò che i siti leggono come bot.
    timeout: 60_000,
  };

  mkdirSync(userDataDir, { recursive: true });
  const markerPath = join(userDataDir, CHANNEL_MARKER);
  let marked: string | null = null;
  try { marked = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() || null : null; } catch { /* ignora */ }

  const forced = process.env.BROWSER_CHANNEL;
  const defaults: Array<string | null> = [...INSTALLED_CHANNELS, null]; // null = Chromium incorporato
  const first = marked === 'chromium' ? null : marked;
  const chain: Array<string | null> = forced
    ? [forced]
    : marked
      ? [first, ...defaults.filter((c) => c !== first)]
      : defaults;

  let last: unknown;
  for (const channel of chain) {
    try {
      const ctx = await launch(userDataDir, { ...base, ...(channel ? { channel } : {}) });
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        const g = globalThis as unknown as { __name?: (fn: unknown) => unknown };
        if (!g.__name) g.__name = (fn: unknown) => fn;
      });
      try { writeFileSync(markerPath, channel ?? 'chromium', 'utf8'); } catch { /* best-effort */ }
      return { ctx, channel };
    } catch (e) {
      last = e;
      if (!isMissingChannelError(e)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error('nessun browser disponibile');
}

/**
 * Context "realistico" (lingua, timezone) per ridurre i blocchi anti-bot.
 *
 * Lo user-agent resta quello vero del browser: forzarne uno fisso (era "Chrome/131") con un browser
 * di un'altra versione crea un'incoerenza fra UA e client hints che i siti leggono come bot.
 * Solo in headless lo si riscrive, togliendo "HeadlessChrome" ma tenendo la versione reale.
 */
export async function newContext(
  browser: Browser,
  opts?: { storageState?: string },
): Promise<BrowserContext> {
  const major = browser.version().split('.')[0] || '131';
  const ctx = await browser.newContext({
    ...(opts?.storageState ? { storageState: opts.storageState } : {}),
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    viewport: { width: 1366, height: 900 },
    ...(process.env.HEADLESS === '1'
      ? { userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36` }
      : {}),
    extraHTTPHeaders: {
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
    },
  });

  // Stealth leggera + shim __name (helper iniettato da esbuild/tsx dentro page.evaluate).
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    const g = globalThis as unknown as { __name?: (fn: unknown) => unknown };
    if (!g.__name) g.__name = (fn: unknown) => fn;
  });

  return ctx;
}
