/** Smoke locale ripetibile: npm run ui:build; npx tsx scripts/try-app.ts
 * Chrome visibile per default; --headless per ambienti senza display.
 * Solo fixture inventate in TEMP, pipeline controllata e rete esterna bloccata.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { chromium, type Page } from 'playwright';
import type { RunSummary } from '../src/core/pipeline.js';

async function main(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), 'hf-app-smoke-'));
  const stateDir = join(temp, 'state');
  const dataDir = join(temp, 'data');
  await mkdir(join(dataDir, 'local'), { recursive: true });
  await mkdir(stateDir);
  for (const key of Object.keys(process.env)) {
    if (/API_KEY|TOKEN|PASS|IMAP_|OPENAI_|OPENROUTER_|GROQ_|ANTHROPIC_|GEMINI_|MODEL|AI_PROVIDER|CUSTOM_BASE_URL|HOUSE_FINDER_/i.test(key)) delete process.env[key];
  }
  Object.assign(process.env, { DATA_DIR: dataDir, STATE_DIR: stateDir,
    LISTINGS_PATH: join(stateDir, 'listings.json'), FB_STATE_PATH: join(stateDir, 'fb.json'),
    THUMBS_DIR: join(stateDir, 'thumbs') });
  const fixture = (name: string, value: unknown) => writeFile(join(dataDir, 'local', name), JSON.stringify(value));
  await fixture('providers.json', { keys: {} });
  // Rende disponibile il solo canale email senza accedere a una casella reale.
  await fixture('mail.json', { host: 'mail.example.invalid', user: 'smoke@example.invalid', pass: 'fixture-only' });
  await fixture('facebook.json', { groups: [], market: [] });
  const nativeFetch = globalThis.fetch;
  const externalAttempts: string[] = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      externalAttempts.push(url.hostname);
      return Promise.reject(new Error('Smoke: rete esterna bloccata'));
    }
    return nativeFetch(input, init);
  };
  const [{ ListingStore }, { createApp }, { saveProfile }, { APP_VERSION }, { default: express }] = await Promise.all([
    import('../src/core/store.js'), import('../src/server/app.js'), import('../src/config/profile.js'),
    import('../src/version.js'), import('express'),
  ]);
  const store = await ListingStore.load(process.env.LISTINGS_PATH);
  let finishRun: (() => void) | undefined;
  let rejectRun: ((reason: Error) => void) | undefined;
  let runCount = 0;
  const streams = new Set<ServerResponse>();
  const app = createApp({ store, stateDir,
    checkUpdate: async () => ({ current: APP_VERSION, latest: null, updateAvailable: false,
      releaseUrl: null, notes: '', asset: null, checked: true, frozen: false, detail: null }),
    runPipeline: async (channels, { log }) => {
      const runId = `fixture-${++runCount}`;
      log?.(`Fixture ${runId}: scansione controllata`);
      await new Promise<void>((resolve, reject) => { finishRun = resolve; rejectRun = reject; });
      return { runId, channels, startedAt: '', finishedAt: '', outcome: 'succeeded',
        results: channels.map((channel) => ({ channel, collected: 2, unique: 2, fresh: 0, newRecords: [], errors: [] })) } satisfies RunSummary;
    },
  });
  const outer = express();
  outer.use((req, res, next) => {
    if (req.path === '/api/runs/stream') { streams.add(res); res.on('close', () => streams.delete(res)); }
    next();
  });
  outer.use(app);
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const listening = outer.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const checks: string[] = [];
  const errors: string[] = [];
  const expectedFailures = new Set<string>();
  const wait = async (predicate: () => Promise<boolean>, description: string) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw new Error(`Timeout: ${description}`);
  };
  const visible = async (page: Page, text: string | RegExp) => {
    await page.getByText(text, { exact: typeof text === 'string' }).filter({ visible: true }).first().waitFor();
  };
  const nav = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
  const addRecords = async () => {
    const now = '2026-10-01T12:00:00Z';
    store.upsert({ source: 'immobiliare', id: 'smoke-1', url: 'https://example.invalid/1',
      title: 'Bilocale fixture Torino', zone: 'Torino', price: 600 }, now,
    { channel: 'email', ai: { score: 90, verdict: 'Fixture di prova', pros: [], cons: [], worthVisit: true } });
    store.upsert({ source: 'subito', id: 'smoke-2', url: 'https://example.invalid/2',
      title: 'Garage fixture Roma', zone: 'Roma', price: 100 }, now, { channel: 'subito' });
    await store.save();
  };
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: process.argv.includes('--headless') });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      externalAttempts.push(url.hostname);
      return route.abort('blockedbyclient');
    });
    const watch = (page: Page) => {
      page.setDefaultTimeout(15_000);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().includes('409 (Conflict)')) errors.push(m.text());
      });
      page.on('response', (response) => {
        if (response.status() >= 400 && !expectedFailures.has(`${response.status()} ${new URL(response.url()).pathname}`)) {
          errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
        }
      });
      page.on('requestfailed', (request) => {
        if (!request.failure()?.errorText.includes('ERR_ABORTED')) errors.push(`Rete: ${request.url()} ${request.failure()?.errorText}`);
      });
    };
    const page = await context.newPage(); watch(page);
    await page.goto(base);
    await visible(page, 'Non hai ancora detto cosa cerchi');
    await page.getByRole('heading', { name: 'Città, tipo di casa e budget' }).waitFor();
    await nav(page, 'Cerca');
    assert.equal(await page.getByRole('button', { name: 'Cerca adesso', exact: true }).isDisabled(), true);
    checks.push('Primo avvio vuoto: guida alla ricerca e scansione disabilitata');
    const searches = [{ id: 'smoke-torino', city: 'torino', label: 'Bilocale Torino', maxPrice: 750, minRooms: 2, maxRooms: 2 },
      { id: 'smoke-roma', city: 'roma', label: 'Bilocale Roma', maxPrice: 850, minRooms: 2, maxRooms: 2 }];
    await saveProfile({ searches, zones: [], musts: [], notes: '' });
    await addRecords();
    await page.reload();
    await page.getByRole('link', { name: 'Bilocale fixture Torino', exact: true }).waitFor();
    await wait(async () => !(await page.getByRole('button', { name: 'Preferito', exact: true }).first().isDisabled()), 'snapshot SSE iniziale');
    await page.getByRole('button', { name: 'Filtra', exact: true }).click();
    await page.getByLabel('Cerca', { exact: true }).fill('Torino');
    await wait(async () => await page.getByRole('button', { name: 'Preferito', exact: true }).count() === 1, 'filtro testo');
    await page.getByRole('button', { name: 'Preferito', exact: true }).click();
    await wait(async () => store.get('immobiliare:smoke-1')?.status === 'favorite', 'stato preferito persistito');
    for (const [label, status] of [['Contattato', 'contacted'], ['Scarta', 'dismissed'], ['Preferito', 'favorite']] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await wait(async () => store.get('immobiliare:smoke-1')?.status === status, `stato ${status} persistito`);
    }
    await page.getByLabel('Stato', { exact: true }).selectOption('favorite');
    await page.getByLabel('Cerca', { exact: true }).fill('');
    await wait(async () => await page.getByRole('button', { name: 'Preferito', exact: true }).count() === 1, 'filtro preferiti');
    await page.getByLabel('Stato', { exact: true }).selectOption('');
    await wait(async () => await page.getByRole('button', { name: 'Preferito', exact: true }).count() === 2, 'ripristino filtri');
    checks.push('Dashboard: filtri testo/stato e preferito/contattato/scartato persistiti');
    await nav(page, 'Profilo');
    await visible(page, 'annunci trovati');
    await nav(page, 'Config'); await nav(page, 'App');
    await page.getByRole('button', { name: 'Ripulisci rumore', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Ripulisci', exact: true }).click();
    await visible(page, 'Ripulito: 1 rimossi, restano 1.');
    await nav(page, 'Annunci');
    await wait(async () => await page.getByRole('button', { name: 'Preferito', exact: true }).count() === 1, 'refresh dashboard dopo ripulitura');
    await nav(page, 'Profilo');
    await visible(page, 'su 1 annunci con prezzo');
    await nav(page, 'Config');
    await page.getByRole('button', { name: 'Svuota archivio', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Svuota', exact: true }).click();
    await visible(page, 'Archivio svuotato: 1 annunci rimossi.');
    await nav(page, 'Annunci'); await visible(page, "Non c'è ancora nessun annuncio");
    await nav(page, 'Profilo'); await visible(page, /Archivio vuoto: non c’è ancora niente da misurare\.|Archivio vuoto: non c'è ancora niente da misurare\./);
    checks.push('Ripulitura e reset aggiornano Annunci e statistiche già montati');
    await addRecords(); await page.reload();
    // La seconda scheda resta su Annunci: Cerca non è mai stato montato.
    const second = await context.newPage(); watch(second); await second.goto(base);
    await second.getByRole('link', { name: 'Bilocale fixture Torino', exact: true }).waitFor();
    await nav(page, 'Cerca');
    await page.getByRole('button', { name: 'Cerca adesso', exact: true }).click();
    await visible(second, 'Scansione in corso');
    assert.equal(await second.getByRole('button', { name: 'Preferito', exact: true }).first().isDisabled(), true);
    await nav(second, 'Cerca'); await visible(second, /Fixture fixture-1: scansione controllata/);
    await visible(second, 'Scansione in corso');
    for (const response of streams) response.end();
    await visible(second, /Fixture fixture-1: scansione controllata/);
    await wait(async () => streams.size === 2, 'riconnessione SSE delle due schede');
    await visible(second, /Fixture fixture-1: scansione controllata/);
    finishRun?.();
    await visible(page, 'Nessun annuncio nuovo questa volta');
    await visible(second, 'Nessun annuncio nuovo questa volta');
    await nav(second, 'Annunci');
    await wait(async () => !(await second.getByRole('button', { name: 'Preferito', exact: true }).first().isDisabled()), 'stati riabilitati a fine run');
    // Simula la corsa fra click e snapshot server: 409 deve restare leggibile in UI.
    expectedFailures.add('409 /api/listings/immobiliare%3Asmoke-1/status');
    await second.route('**/api/listings/*/status', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'run_in_progress' }) }));
    await second.getByRole('button', { name: 'Preferito', exact: true }).first().click();
    await visible(second, 'Stato non aggiornato'); await visible(second, /Archivio occupato: attendi/);
    await second.unroute('**/api/listings/*/status');
    checks.push('Due schede, stato run globale, riconnessione SSE, stati bloccati e 409 gentile');
    await page.getByRole('button', { name: 'Cerca adesso', exact: true }).click();
    await visible(page, /Fixture fixture-2: scansione controllata/);
    assert.equal(await page.getByText('Nessun annuncio nuovo questa volta', { exact: true }).isVisible(), false);
    rejectRun?.(new Error('Errore fixture controllato'));
    await visible(page, /ERRORE: Errore fixture controllato/);
    await page.getByRole('button', { name: 'Cerca adesso', exact: true }).waitFor({ state: 'visible' });
    await wait(async () => !(await page.getByRole('button', { name: 'Cerca adesso', exact: true }).isDisabled()), 'run fallita libera il pulsante');
    checks.push('Seconda run azzera il riepilogo; errore terminale libera la UI');
    const updatePage = await context.newPage(); watch(updatePage);
    let stale = false;
    let clearedStale = 0;
    await updatePage.route('**/api/update/check*', (route) => route.fulfill({ json: {
      current: APP_VERSION, latest: '99.0.0', updateAvailable: true, releaseUrl: null,
      notes: '', checked: true, frozen: true, detail: null,
    } }));
    await updatePage.route('**/api/update/progress', (route) => route.fulfill({ json: {
      step: 'download', pct: 30, detail: 'Download fixture lento', ts: Date.now() - 600_000,
      busy: !stale, lockStale: stale,
    } }));
    await updatePage.route('**/api/update/lock', (route) => { clearedStale++; return route.fulfill({ json: { ok: true } }); });
    await updatePage.clock.install();
    await updatePage.goto(base); await nav(updatePage, 'Config'); await nav(updatePage, 'App');
    await visible(updatePage, 'Download fixture lento');
    await updatePage.clock.fastForward(300_001);
    assert.equal(await updatePage.getByRole('button', { name: 'Sblocca e riprova', exact: true }).count(), 0);
    assert.equal(await updatePage.getByText('Aggiornamento non riuscito', { exact: true }).count(), 0);
    stale = true;
    await updatePage.clock.fastForward(2_001);
    await updatePage.getByRole('button', { name: 'Sblocca e riprova', exact: true }).waitFor();
    await updatePage.getByRole('button', { name: 'Sblocca e riprova', exact: true }).click();
    await wait(async () => clearedStale === 1, 'sblocco solo del lock stale');
    await updatePage.close();
    checks.push('Updater UI: oltre cinque minuti resta occupato; sblocco disponibile solo con lock stale');
    await nav(page, 'Annunci');
    await page.screenshot({ path: join(temp, 'desktop.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async () => { await document.fonts.ready; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'niente overflow mobile');
    await page.screenshot({ path: join(temp, 'mobile.png'), fullPage: true, animations: 'disabled' });
    checks.push('Desktop 1440 e mobile 390: layout senza overflow');
    assert.deepEqual(externalAttempts, [], 'nessuna richiesta esterna');
    assert.deepEqual(errors, [], 'nessun errore JS/console/rete inatteso');
    const saved = JSON.parse(await readFile(process.env.LISTINGS_PATH!, 'utf8')) as Record<string, unknown>;
    assert.equal(Object.keys(saved).length, 2);
    await writeFile(join(temp, 'report.json'), JSON.stringify({ ok: true, checks, errors, externalAttempts }, null, 2));
    console.log(JSON.stringify({ ok: true, checks, artifacts: temp }, null, 2));
  } catch (e) {
    const failure = e instanceof Error ? e.message : String(e);
    const page = browser?.contexts()[0]?.pages()[0];
    await page?.screenshot({ path: join(temp, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
    await writeFile(join(temp, 'report.json'), JSON.stringify({ ok: false, failure, checks, errors, externalAttempts }, null, 2));
    console.error(`Smoke fallito: artefatti in ${temp}`);
    throw e;
  } finally {
    finishRun?.();
    await browser?.close();
    for (const response of streams) response.end();
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
    store.close();
    globalThis.fetch = nativeFetch;
  }
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
