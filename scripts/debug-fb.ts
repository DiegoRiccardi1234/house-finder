import 'dotenv/config';
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { launchBrowser, newContext } from '../src/core/browser.js';
import { autoScroll, gotoResilient } from '../src/sources/page-utils.js';
import { FB_STATE_PATH, FB_MAX_SCROLL, loadFbConfig } from '../src/config/facebook.js';

/**
 * Diagnostica FEED Facebook per tarare i selettori (headed, con la sessione da fb:from-brave).
 * Apre un gruppo, scrolla col nuovo autoScroll, stampa il conteggio dei selettori candidati e
 * dumpa il DOM del feed in `debug/fb-feed.html` per ispezione.
 *
 *   npm run debug:fb            → primo gruppo
 *   npm run debug:fb -- 2       → gruppo con indice 2
 *
 * Richiede: Brave CHIUSO + sessione FB valida (npm run fb:from-brave prima, se scaduta).
 */
async function main(): Promise<void> {
  if (!existsSync(FB_STATE_PATH)) {
    console.error(`Sessione assente: ${FB_STATE_PATH}. Lancia prima: npm run fb:from-brave (Brave chiuso).`);
    process.exit(1);
  }
  const idx = Number(process.argv[2] ?? '0') || 0;
  const { groups } = loadFbConfig();
  const g = groups[idx] ?? groups[0];
  console.log(`Gruppo [${idx}] ${g.name}\n${g.url}`);

  const browser = await launchBrowser();
  try {
    const ctx = await newContext(browser, { storageState: FB_STATE_PATH });
    const page = await ctx.newPage();
    const url = g.url.replace(/\/?$/, '/') + '?sorting_setting=CHRONOLOGICAL';
    await gotoResilient(page, url);
    for (let i = 0; i < FB_MAX_SCROLL; i++) await autoScroll(page);

    const diag = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      return {
        hasFeed: !!feed,
        feedArticles: document.querySelectorAll('div[role="feed"] div[role="article"]').length,
        articlesGlobal: document.querySelectorAll('div[role="article"]').length,
        postLinks: document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]').length,
        scrollHeight: document.body.scrollHeight,
        feedHtml: feed ? (feed as HTMLElement).outerHTML : document.body.outerHTML,
      };
    });

    console.log(`hasFeed=${diag.hasFeed} · feedArticles=${diag.feedArticles} · articlesGlobal=${diag.articlesGlobal} · postLinks=${diag.postLinks} · scrollHeight=${diag.scrollHeight}`);
    await mkdir('debug', { recursive: true });
    await writeFile('debug/fb-feed.html', diag.feedHtml, 'utf8');
    console.log('DOM feed → debug/fb-feed.html (ispeziona per tarare i selettori)');
    await page.close();
    await ctx.close();
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
