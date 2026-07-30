import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { sources } from '../src/sources/index.js';
import { searches } from '../src/config/searches.js';
import { launchBrowser, newContext } from '../src/core/browser.js';
import { gotoResilient, autoScroll } from '../src/sources/page-utils.js';

// Uso: npm run debug:page -- <source> <profileId>
const sourceName = process.argv[2] ?? 'subito';
const profileId = process.argv[3] ?? 'torino-bilocale';
const source = sources.find((s) => s.name === sourceName)!;
const profile = searches.find((p) => p.id === profileId)!;

const browser = await launchBrowser();
const ctx = await newContext(browser);
const page = await ctx.newPage();

const url = source.buildUrl(profile);
console.log('buildUrl:', url);
await gotoResilient(page, url);
await autoScroll(page);

const diag = await page.evaluate(() => {
  const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  const hrefs = anchors.map((a) => a.href);
  // pattern: raggruppa per prefisso path (primi 2 segmenti) per capire dove stanno gli annunci
  const withDigits = hrefs.filter((h) => /\d{4,}/.test(h));
  const sample = Array.from(new Set(withDigits)).slice(0, 20);
  const nextEl = document.getElementById('__NEXT_DATA__');
  let nextKeys: string[] = [];
  if (nextEl) {
    try {
      const j = JSON.parse(nextEl.textContent || '{}');
      nextKeys = Object.keys(j?.props?.pageProps ?? j?.props ?? j ?? {});
    } catch {
      /* ignore */
    }
  }
  return {
    title: document.title,
    totalAnchors: anchors.length,
    hrefsWithDigits: withDigits.length,
    sample,
    hasNextData: !!nextEl,
    nextKeys,
    bodySnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
  };
});

console.log('finalUrl:', page.url());
console.log(JSON.stringify(diag, null, 2));

await mkdir('debug', { recursive: true });
await writeFile(`debug/${sourceName}.html`, await page.content(), 'utf8');
await page.screenshot({ path: `debug/${sourceName}.png`, fullPage: false });
console.log(`\nSalvati debug/${sourceName}.html e debug/${sourceName}.png`);

await ctx.close();
await browser.close();
