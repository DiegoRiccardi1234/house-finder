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
