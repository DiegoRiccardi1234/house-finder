import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { sources } from '../src/sources/index.js';
import { searches } from '../src/config/searches.js';
import { launchBrowser, newContext } from '../src/core/browser.js';
import { gotoResilient } from '../src/sources/page-utils.js';

const sourceName = process.argv[2] ?? 'subito';
const profileId = process.argv[3] ?? 'torino-bilocale';
const source = sources.find((s) => s.name === sourceName)!;
const profile = searches.find((p) => p.id === profileId)!;

const browser = await launchBrowser();
const ctx = await newContext(browser);
const page = await ctx.newPage();
await gotoResilient(page, source.buildUrl(profile));
await page.waitForTimeout(2500);

const result = await page.evaluate(() => {
  const el = document.getElementById('__NEXT_DATA__');
  if (!el) return { hasNext: false };
  const root = JSON.parse(el.textContent || '{}');

  // Trova array di oggetti "grandi" (candidati liste annunci) con il loro path.
  // Walk iterativo: niente funzioni nominate (evita l'helper __name di esbuild/tsx).
  const found: Array<{ path: string; len: number; keys: string[] }> = [];
  const seen = new Set<unknown>();
  const stack: Array<{ node: unknown; path: string; depth: number }> = [
    { node: root, path: '', depth: 0 },
  ];
  while (stack.length) {
    const { node, path, depth } = stack.pop()!;
    if (depth > 8 || node === null || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.length >= 3 && typeof node[0] === 'object' && node[0] !== null) {
        found.push({ path, len: node.length, keys: Object.keys(node[0] as object).slice(0, 25) });
      }
      node.slice(0, 3).forEach((v, i) => stack.push({ node: v, path: `${path}[${i}]`, depth: depth + 1 }));
    } else {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        stack.push({ node: v, path: path ? `${path}.${k}` : k, depth: depth + 1 });
      }
    }
  }
  return { hasNext: true, arrays: found, fullSize: (el.textContent || '').length };
});

console.log(JSON.stringify(result, null, 2));

await mkdir('debug', { recursive: true });
const el = await page.$('#__NEXT_DATA__');
if (el) await writeFile(`debug/${sourceName}-next.json`, (await el.textContent()) || '', 'utf8');

await ctx.close();
await browser.close();
