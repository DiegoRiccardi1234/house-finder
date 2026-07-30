/**
 * Helper PURI per il parsing dei post/annunci Facebook (testabili senza browser).
 * La parte DOM sta in facebook-groups.ts / facebook-marketplace.ts; qui solo logica su stringhe.
 */

/** Estrae l'id di un post dal suo permalink di gruppo FB. Null se non riconosciuto. */
export function parsePostId(href: string | null | undefined): string | null {
  if (!href) return null;
  const patterns = [
    /\/groups\/[^/]+\/(?:posts|permalink)\/(\d+)/,
    /[?&]multi_permalinks=(\d+)/,
    /[?&]story_fbid=(\d+)/,
    /\/permalink\/(\d+)/,
    /\/posts\/(\d+)/,
  ];
  for (const re of patterns) {
    const m = href.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Estrae l'id di un item da un link Marketplace. */
export function parseMarketplaceId(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/marketplace\/item\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Primo prezzo in € da un testo libero (post FB). Null se assente.
 * Ancorato a €/euro per evitare falsi positivi (mq, anni, civici).
 */
export function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/€\s*(\d[\d.\s]{1,6})|(\d[\d.\s]{1,6})\s*(?:€|euro|eur\b)/i);
  if (!m) return null;
  const digits = (m[1] ?? m[2] ?? '').replace(/[^\d]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) && n >= 100 && n <= 10000 ? n : null;
}

/** Prima riga non vuota, troncata: fa da "titolo" per un post senza titolo. */
export function firstLine(text: string, max = 90): string {
  const line = (text || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) ?? '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

const META = /^(·\s*)?(segui|follow|suggerit|iscriviti|partecipa|membro)\b/i;
const TIMESTAMP = /^\d+\s*(h|g|gg|min|minut|ore?|settiman|sett|giorni?|d|sett\.)\b/i;
const GREETING = /^(ciao+|salve|buongiorno|buon\s?giorno|buonasera|buona\s?sera|buonaserata|grazie|hey+|ehi|raga|ragazzi)[\s!,.]*$/i;
const PRICE_ONLY = /^[€\s]*\d[\d.\s]*\s*€?\s*$/;
const nameLike = (l: string): boolean =>
  l.split(/\s+/).length <= 4 && !/[\d€]|affitt|bilocal|trilocal|monolocal|quadrilocal|stanz|camera|appartament|mq|m²|zona|vend/i.test(l);

/**
 * Titolo "sensato" da un blob di testo FB: salta la riga autore (post gruppo) e le righe meta
 * (Segui, timestamp), e per il Marketplace la riga solo-prezzo. Ritorna la prima riga di contenuto.
 */
export function smartTitle(text: string, opts: { skipAuthor?: boolean; skipPrice?: boolean } = {}, max = 90): string {
  const lines = (text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  const start = opts.skipAuthor && lines.length > 1 && nameLike(lines[0]) ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (META.test(l) || TIMESTAMP.test(l)) continue;
    if (l.length <= 15 && GREETING.test(l)) continue; // salta i saluti brevi ("Ciao", "Salve")
    if (opts.skipPrice && PRICE_ONLY.test(l)) continue;
    if (l.length < 3) continue;
    return l.length > max ? l.slice(0, max - 1) + '…' : l;
  }
  const fb = lines[0];
  return fb.length > max ? fb.slice(0, max - 1) + '…' : fb;
}

/** Testo compattato e troncato, da dare al giudizio AI. */
export function cleanText(text: string, max = 500): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Rimuove la chrome/meta FB (etichette e barra azioni) preservando le andate a capo. */
export function stripFbChrome(text: string): string {
  return (text || '')
    .replace(/persona (sempre )?più attiva/gi, ' ')
    .replace(/inviato messaggio privato/gi, ' ')
    .replace(/·\s*segui/gi, ' ')
    .replace(/\bmi piace\b[\s·]*rispondi[\s·]*condividi[\s\d]*/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Deve parlare di un'abitazione (stanza/appartamento/…), altrimenti non è un annuncio casa.
const DWELLING =
  /stanz[ae]?|singol|doppia|posto\s*letto|monolocal|monovan|bilocal|trilocal|quadrilocal|appartament|\bloft\b|attico|alloggio|\bcamera\b|\bcamere\b|\blocal[ei]\b/i;
// Domanda/ricerca (NON offerta): chi cerca o commenta, non chi affitta.
const DEMAND =
  /\bcerco\b|cercasi|in cerca|sono interess|sono intres|\binteressat[oa]|\bintresat|ti ho scritto|scrivetemi|poss[oi]\s+(avere|venire|sapere)|potre[ib]{1,2}\s+(avere|sapere|venire)|qualcun[oa]\s+(ha|sa|cerca)|ancora\s+(disponibil|liber)|(è|e')\s*ancora\s*(liber|disponibil)|libera\?|disponibile\?|\?\s*$/i;
// Vendita (arredamento, ecc.), non affitto.
const SALE = /\bvendo\b|vendesi|in vendita|\bvend[eo]\b/i;

/**
 * L'article (post o commento) è una vera OFFERTA di casa/stanza in affitto?
 * Tiene le offerte (anche nei commenti: "ho 3 stanze libere"); scarta saluti/chrome, DOMANDE
 * ("sono interessato per la stanza", "è ancora disponibile?"), VENDITE ("Vendo arredamento") e i
 * non-affitti del Marketplace ("Cucina con elettrodomestici").
 */
export function looksLikeListing(text: string): boolean {
  const t = stripFbChrome(text).toLowerCase();
  if (t.length < 15) return false;
  if (!DWELLING.test(t)) return false;
  if (SALE.test(t)) return false;
  if (DEMAND.test(t)) return false;
  return true;
}

/** Affitto breve/giornaliero (non un canone mensile): il prezzo non va mostrato come mensile. */
export function isShortTerm(text: string): boolean {
  return /a\s*notte|al\s*giorno|giornalier|\/\s*(notte|giorno)|affitt[oi]?\s*brev|breve\s*period|weekend|vacanz/i.test(
    text || '',
  );
}
