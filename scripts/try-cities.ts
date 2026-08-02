/**
 * Verifica l'elenco delle città contro i tre portali veri.
 *
 * Un elenco di 107 voci composto per regola è una speranza finché qualcuno non la misura: i nomi
 * con l'apostrofo, le province che non si chiamano come il capoluogo e le abbreviazioni dei
 * portali si scoprono solo chiedendo. Dove il percorso non esiste, si mette un `override` in
 * `src/config/cities.ts` — misurato, non indovinato.
 *
 * Il segnale che conta è **404**: vuol dire percorso sbagliato. Un 403 non dice niente sulla
 * città (è l'antibot che rifiuta una richiesta senza browser) e viene riportato come tale, senza
 * fingere di essere una risposta.
 *
 * Uso: `npm run try:cities [-- --city milano] [-- --portal subito]`
 */
import { CITIES, cityPath } from '../src/config/cities.js';
import type { SearchProfile } from '../src/core/types.js';
import { subito } from '../src/sources/subito.js';
import { immobiliare } from '../src/sources/immobiliare.js';
import { idealista } from '../src/sources/idealista.js';

type Portale = 'subito' | 'immobiliare' | 'idealista';
const PORTALI: Record<Portale, { buildUrl: (p: SearchProfile) => string }> = {
  subito,
  immobiliare,
  idealista,
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

type Esito = 'ok' | 'assente' | 'bloccato' | 'errore';

async function prova(url: string): Promise<{ esito: Esito; dettaglio: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return { esito: 'assente', dettaglio: '404' };
    if (res.status === 403 || res.status === 429) {
      return { esito: 'bloccato', dettaglio: String(res.status) };
    }
    // Un reindirizzamento verso la home è il modo educato di dire "questa pagina non esiste".
    if (res.status >= 300 && res.status < 400) {
      const dove = res.headers.get('location') ?? '';
      const versoHome = /^https?:\/\/[^/]+\/?$/.test(dove);
      return versoHome
        ? { esito: 'assente', dettaglio: `→ home` }
        : { esito: 'ok', dettaglio: `→ ${dove.slice(0, 60)}` };
    }
    if (res.ok) return { esito: 'ok', dettaglio: String(res.status) };
    return { esito: 'errore', dettaglio: String(res.status) };
  } catch (e) {
    return { esito: 'errore', dettaglio: (e as Error).message.slice(0, 40) };
  }
}

/** Poche richieste per volta: si sta verificando un elenco, non facendo un test di carico. */
async function aScaglioni<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const soloCitta = arg('city');
  const soloPortale = arg('portal') as Portale | undefined;

  const citta = soloCitta ? CITIES.filter((c) => c.slug === soloCitta) : CITIES;
  if (citta.length === 0) {
    console.error(`Città "${soloCitta}" non è nell'elenco.`);
    process.exit(1);
  }
  const portali = (soloPortale ? [soloPortale] : Object.keys(PORTALI)) as Portale[];

  console.log(`Verifico ${citta.length} città su ${portali.join(', ')}.\n`);

  const problemi: string[] = [];
  let bloccati = 0;

  for (const portale of portali) {
    console.log(`▶ ${portale}`);
    const esiti = await aScaglioni(citta.slice(), 4, async (c) => {
      const url = `https://www.${portale}.it/${cityPath(c.slug, portale)}`;
      const { esito, dettaglio } = await prova(url);
      return { c, esito, dettaglio, url };
    });

    for (const e of esiti) {
      if (e.esito === 'ok') continue;
      if (e.esito === 'bloccato') {
        bloccati++;
        continue;
      }
      const riga = `   ${e.esito === 'assente' ? '❌' : '⚠️ '} ${e.c.slug} (${e.dettaglio}) ${e.url}`;
      console.log(riga);
      if (e.esito === 'assente') problemi.push(`${portale}: ${e.c.slug} → ${e.url}`);
    }
    const ok = esiti.filter((e) => e.esito === 'ok').length;
    const bl = esiti.filter((e) => e.esito === 'bloccato').length;
    console.log(`   ${ok}/${esiti.length} raggiungibili${bl ? `, ${bl} non verificabili (antibot)` : ''}\n`);
  }

  if (bloccati > 0) {
    console.log(
      `Nota: ${bloccati} risposte sono antibot (403/429). Non dicono niente sulla città:\n` +
        `      quei percorsi si verificano solo con \`npm run try:source\`, che usa il browser vero.\n`,
    );
  }

  if (problemi.length === 0) {
    console.log('✅ Nessun percorso mancante fra quelli verificabili.');
    return;
  }
  console.log(`❌ ${problemi.length} percorsi non esistono. Servono override in src/config/cities.ts:`);
  for (const p of problemi) console.log(`   ${p}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
