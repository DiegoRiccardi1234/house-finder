/** Explicit read-only-account Facebook QA: headed, existing cookies, isolated archive, no AI/login/writes to the account. */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, type Page, type Browser } from 'playwright';

async function hash(path: string): Promise<string | null> {
  try { return createHash('sha256').update(await readFile(path)).digest('hex'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function safeCode(message: string): string {
  if (/sessione assente/i.test(message)) return 'session_missing';
  if (/sessione scaduta|non valida/i.test(message)) return 'session_invalid';
  if (/captcha|checkpoint|challenge/i.test(message)) return 'account_challenge';
  if (/timeout|Timeout/i.test(message)) return 'content_timeout';
  if (/Target.*closed|browser.*closed|context.*closed/i.test(message)) return 'browser_closed';
  if (/salvataggio fallito/i.test(message)) return 'save_failed';
  return 'source_error';
}
async function main() {
  const root = process.cwd();
  const configuredState = resolve(process.env.FB_STATE_PATH ?? 'state/fb-state.json');
  const archive = resolve(process.env.LISTINGS_PATH ?? 'state/listings.json');
  const argument = process.argv.indexOf('--report-dir');
  const reportDir = argument >= 0 ? resolve(process.argv[argument + 1])
    : resolve('.house-finder-private', `implementation-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  if (!reportDir.startsWith(resolve(root, '.house-finder-private') + '\\') && !reportDir.startsWith(resolve(root, '.house-finder-private') + '/'))
    throw new Error('Report directory must be inside the project private folder.');
  const work = join(reportDir, 'facebook-live-isolated');
  await mkdir(work, { recursive: true });
  const sessionBefore = await hash(configuredState), archiveBefore = await hash(archive);
  const originalLog = console.log, originalError = console.error;
  // Source logs include group names and URLs. Keep them out of stdout and the public report.
  console.log = () => {}; console.error = () => {};
  Object.assign(process.env, { FB_STATE_PATH: configuredState, FB_MAX_SCROLL: '2', BROWSER_CHANNEL: 'chrome', HEADLESS: '0',
    STATE_DIR: work, LISTINGS_PATH: join(work, 'listings.json'), THUMBS_DIR: join(work, 'thumbs') });
  let blocked: string | undefined;
  let ownedBrowser: Browser | undefined;
  const launch = chromium.launch.bind(chromium);
  // Observe only the browser launched by this harness. On login/challenge, stop this
  // attempt immediately instead of probing other groups or attempting an account action.
  chromium.launch = async (options) => {
    const browser = await launch(options); ownedBrowser = browser;
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions) => {
      const context = await newContext(contextOptions);
      const stop = (code: string) => { blocked ??= code; void browser.close().catch(() => {}); };
      const watch = (page: Page) => {
        let checking = false;
        const check = async () => {
          if (checking || page.isClosed() || blocked) return;
          checking = true;
          try {
            const path = new URL(page.url()).pathname;
            if (/\/(checkpoint|challenge|captcha)(\/|$)/i.test(path)) { stop('account_challenge'); return; }
            if (/\/(login|login\.php)(\/|$)/i.test(path)) { stop('login_required'); return; }
            if (await page.locator('form[action*="checkpoint"], iframe[src*="captcha"], [name="captcha_response"]').count()) { stop('account_challenge'); return; }
            if (await page.locator('form#login_form, input[name="email"][type="text"], input[name="email"][type="email"]').count()) stop('login_required');
          } catch { /* Page may close during the source's normal lifecycle. */ }
          finally { checking = false; }
        };
        const timer = setInterval(() => { void check(); }, 1000);
        page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) void check(); });
        page.on('domcontentloaded', () => { void check(); });
        page.on('close', () => clearInterval(timer));
      };
      context.on('page', watch);
      return context;
    };
    return browser;
  };
  const startedAt = new Date().toISOString();
  let report: Record<string, unknown> = { startedAt, source: 'facebook', score: false, vision: false, headed: true, maxScroll: 2 };
  let store: { close(): void } | undefined;
  try {
    const [{ ListingStore }, { runPipeline }, { loadFbConfig }] = await Promise.all([
      import('../src/core/store.js'), import('../src/core/pipeline.js'), import('../src/config/facebook.js'),
    ]);
    const config = loadFbConfig();
    const counts = { groups: config.groups.length, marketplaceTargets: config.market.length };
    if (await hash(join(work, 'listings.json'))) { blocked = 'isolated_archive_exists'; report = { ...report, ...counts }; }
    else if (!sessionBefore) { blocked = 'session_missing'; report = { ...report, ...counts }; }
    else if (!config.groups.length && !config.market.length) { blocked = 'sources_not_configured'; report = { ...report, ...counts }; }
    else {
      const isolated = await ListingStore.load(join(work, 'listings.json'), { exclusive: true }); store = isolated;
      const result = await runPipeline(['facebook'], { store: isolated, score: false, vision: false, log: () => {} });
      const channels = result.results.map((entry) => ({ channel: entry.channel, collected: entry.collected, unique: entry.unique,
        fresh: entry.fresh, outcome: entry.outcome, persisted: entry.persisted, errorCodes: [...new Set(entry.errors.map(safeCode))] }));
      report = { ...report, ...counts, outcome: result.outcome, channels, stored: isolated.size,
        statuses: Object.fromEntries(['new', 'favorite', 'contacted', 'dismissed'].map((status) => [status, isolated.all().filter((entry) => entry.status === status).length])) };
      if (!blocked && channels.some((entry) => entry.errorCodes.includes('session_invalid'))) blocked = 'session_invalid';
      if (!blocked && isolated.size === 0) blocked = 'no_listing_persisted';
    }
  } catch { blocked ??= 'pipeline_failed'; }
  finally {
    store?.close(); await ownedBrowser?.close().catch(() => {});
    chromium.launch = launch;
    console.log = originalLog; console.error = originalError;
    report = { ...report, finishedAt: new Date().toISOString(), blocked: blocked ?? null,
      sourceSessionUnchanged: sessionBefore === await hash(configuredState), sourceArchiveUnchanged: archiveBefore === await hash(archive),
      isolatedStore: 'facebook-live-isolated/listings.json' };
    await writeFile(join(reportDir, 'facebook-live.json'), JSON.stringify(report, null, 2));
    originalLog(JSON.stringify(report, null, 2));
    originalLog(`Report: ${join(reportDir, 'facebook-live.json')}`);
    if (blocked || report.outcome !== 'succeeded') process.exitCode = 1;
  }
}
main().catch(() => { console.error('Facebook live: preflight_failed. Nessun login o modifica account avviati.'); process.exitCode = 1; });
