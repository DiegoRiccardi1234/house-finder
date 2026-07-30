import 'dotenv/config';
import { sources } from '../src/sources/index.js';
import { searches } from '../src/config/searches.js';
import { launchBrowser, newContext } from '../src/core/browser.js';

// Uso: npm run try:source -- <source> <profileId>
// es:  npm run try:source -- subito torino-bilocale
const sourceName = process.argv[2] ?? 'subito';
const profileId = process.argv[3] ?? 'torino-bilocale';

const source = sources.find((s) => s.name === sourceName);
const profile = searches.find((p) => p.id === profileId);
if (!source) throw new Error(`source sconosciuto: ${sourceName}`);
if (!profile) throw new Error(`profilo sconosciuto: ${profileId}`);

const browser = await launchBrowser();
const ctx = await newContext(browser);

console.log('URL:', source.buildUrl(profile));
const listings = await source.fetch(profile, ctx);
console.log(`\nTrovati ${listings.length} annunci. Primi 5:\n`);
console.log(JSON.stringify(listings.slice(0, 5), null, 2));

await ctx.close();
await browser.close();
