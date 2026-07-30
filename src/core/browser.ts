import { chromium, type Browser, type BrowserContext } from 'playwright';

/**
 * Avvia Chromium. Supporta un proxy opzionale via PROXY_URL:
 * utile se un portale blocca gli IP datacenter di GitHub Actions.
 */
export async function launchBrowser(): Promise<Browser> {
  const proxyUrl = process.env.PROXY_URL;
  // I portali (Akamai/DataDome) bloccano il browser headless: default = HEADED.
  // HEADLESS=1 forza headless solo per debug del blocco.
  const headless = process.env.HEADLESS === '1';
  return chromium.launch({
    headless,
    channel: process.env.BROWSER_CHANNEL || undefined, // es. 'chrome' per Chrome reale
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

/** Context "realistico" (UA, lingua, timezone) per ridurre i blocchi anti-bot. */
export async function newContext(
  browser: Browser,
  opts?: { storageState?: string },
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    ...(opts?.storageState ? { storageState: opts.storageState } : {}),
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
