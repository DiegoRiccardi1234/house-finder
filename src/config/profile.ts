import { readFileSync } from 'node:fs';
import { writeFileAtomic } from '../core/atomic.js';
import { configReadPath, localConfigPath } from './paths.js';

/**
 * Cosa cerchi, in una forma che un modulo può leggere e una schermata può modificare.
 *
 * Prima esistevano due file e nessuno dei due era modificabile da chi non programma:
 * `searches.json` (un array JSON con `minRooms`/`maxRooms`, mostrato grezzo nella UI) e
 * `criteria.md` (un prompt in markdown da scrivere a mano). Chi apriva quella schermata non
 * poteva sapere cosa toccare — e il pulsante "Modifica" del profilo ci atterrava sopra.
 *
 * Ora la fonte di verità è questo profilo. Da qui si **generano** gli altri due, che restano
 * quelli che il resto dell'app legge già: gli scraper continuano a usare `searches.json`, l'AI
 * continua a ricevere `criteria.md`. Nessuna parte della pipeline è stata toccata.
 *
 * Quello che NON si mette in un form è `notes`: scrivere i criteri in parole proprie è il punto
 * di forza del prodotto, non un ripiego — è lì che vivono le sfumature che nessun campo prevede
 * ("il centro solo se è sotto la metà del tetto"). Il form copre lo scheletro, le parole il resto.
 */

export interface SearchRow {
  id: string;
  city: string;
  label: string;
  maxPrice: number;
  minRooms?: number;
  maxRooms?: number;
}

export interface CityZones {
  city: string;
  /** Quartieri buoni. Vuoto = nessuna preferenza, e allora la zona non filtra. */
  keep: string[];
  avoid: string[];
}

export interface Profile {
  searches: SearchRow[];
  zones: CityZones[];
  /** Etichette libere: "Arredato", "Prezzo entro il tetto", … */
  musts: string[];
  /** Tutto quello che un campo non prevede, in parole tue. Finisce nel prompt così com'è. */
  notes: string;
}

export const EMPTY_PROFILE: Profile = { searches: [], zones: [], musts: [], notes: '' };

const PROFILE_FILE = 'profile.json';
const SEARCHES_FILE = 'searches.json';
const CRITERIA_FILE = 'criteria.md';
const SPAZIO = String.fromCharCode(32);

let cache: Profile | null = null;

export function invalidateProfile(): void {
  cache = null;
}

/** Titolo leggibile per una città scritta in minuscolo negli id. */
export function cityLabel(city: string): string {
  return city.replace(/(^|[\s-])\p{Ll}/gu, (m) => m.toUpperCase());
}

// --- Lettura ---------------------------------------------------------------------------------

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Zone da un `criteria.md` scritto a mano.
 *
 * Tollerante di proposito: chi scrive markdown libero non segue uno schema, e un parser severo
 * qui direbbe "nessuna zona" su un file pieno di zone. Quando non riconosce niente lo dichiara,
 * invece di far sparire in silenzio quello che l'utente aveva scritto.
 */
export function parseZoneLines(criteria: string): { keep: string[]; avoid: string[] } {
  const split = (s: string): string[] =>
    s
      .split(/[,;·]/)
      .map((x) => x.replace(/\((core|ok)\)/gi, '').replace(/\.\s*$/, '').trim())
      .filter((x) => x.length > 1 && x.length < 40);

  /**
   * Taglia la cattura dove comincia l'elenco opposto.
   *
   * Il salto di riga non basta: quando TIENI e SCARTA stanno sulla **stessa** riga, `[^\n]*` si
   * mangia anche il secondo, e fra i quartieri buoni compare un "Santa Rita nord. SCARTA: Barriera".
   */
  const fino = (s: string, altro: RegExp): string => {
    const i = s.search(altro);
    return i < 0 ? s : s.slice(0, i);
  };

  const keep: string[] = [];
  const avoid: string[] = [];
  for (const m of criteria.matchAll(
    /TIENI:\s*([^\n]*(?:\n(?!\s*(?:SCARTA|NO-GO|NOTE|-\s*[A-Z]))[^\n]*)*)/gi,
  )) {
    keep.push(...split(fino(m[1] ?? '', /\b(SCARTA|NO-GO|NOTE)\s*:/i)));
  }
  for (const m of criteria.matchAll(
    /SCARTA:\s*([^\n]*(?:\n(?!\s*(?:TIENI|NO-GO|NOTE|-\s*[A-Z]))[^\n]*)*)/gi,
  )) {
    avoid.push(...split(fino(m[1] ?? '', /\b(TIENI|NO-GO|NOTE)\s*:/i)));
  }
  const uniq = (a: string[]): string[] => Array.from(new Set(a));
  return { keep: uniq(keep), avoid: uniq(avoid) };
}

/** Riga per riga il blocco MUST-HAVE, senza le spiegazioni fra parentesi. */
export function parseMusts(criteria: string): string[] {
  const m = criteria.match(/MUST-HAVE[^\n]*:?\s*\n((?:\s*-\s*[^\n]+\n?)+)/i);
  if (!m?.[1]) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .map((l) => l.replace(/\s*\([^)]*\)\s*/g, SPAZIO).replace(/[.;]+\s*$/, '').trim())
    .filter(Boolean);
}

/**
 * Quello che il form non modella e che va conservato parola per parola.
 *
 * Sono le sezioni in coda (`NO-GO`, `NOTE`) più tutto ciò che segue: le sfumature scritte a mano,
 * che sono la parte più preziosa del file e l'unica che una migrazione può distruggere per sempre.
 */
export function parseNotes(criteria: string): string {
  const i = criteria.search(/^\s*(NO-GO|NOTE)\b/im);
  if (i < 0) return '';
  return criteria
    .slice(i)
    // Via il pié di pagina che spiega com'è fatto il file di esempio: è documentazione, non criteri.
    .replace(/\n---[\s\S]*$/, '')
    .trim();
}

/**
 * Solo la sezione ZONE, dall'intestazione alla sezione successiva.
 *
 * Restringere il campo non è pignoleria: nel formato storico anche BUDGET ha una riga per città
 * (`- Torino: bilocale ≤ 700€`), e cercare "- Torino" in tutto il file trovava quella. Il blocco
 * risultava senza TIENI/SCARTA, le zone sembravano assenti, e il ripiego finiva per ammucchiare
 * i quartieri di ogni città sotto la prima.
 */
function zoneSection(criteria: string): string {
  const righe = criteria.split('\n');
  const inizio = righe.findIndex((l) => /^ZONE\b/i.test(l));
  if (inizio < 0) return criteria;
  const out = [righe[inizio] ?? ''];
  // Si va avanti per righe. Cercare la sezione successiva con un `search` sul testo tagliato di
  // un carattere sembrava più corto, ma "ZONE" senza la Z diventa "ONE" e faceva match con sé
  // stessa: la sezione si riduceva a una lettera e le zone sparivano tutte.
  for (let i = inizio + 1; i < righe.length; i++) {
    const l = righe[i] ?? '';
    if (/^[A-ZÀ-Ü][A-ZÀ-Ü-]{2,}\b/.test(l)) break; // NO-GO, NOTE, BUDGET…
    out.push(l);
  }
  return out.join('\n');
}

/**
 * Il blocco di righe che riguarda una città dentro la sezione ZONE.
 *
 * Comincia con `- <Città>` e prosegue nelle righe rientrate finché non arriva un altro elenco,
 * una riga vuota o una sezione nuova a inizio colonna.
 */
function cityBlock(criteria: string, city: string): string {
  const nome = cityLabel(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const righe = zoneSection(criteria).split('\n');
  const inizio = righe.findIndex((l) => new RegExp(`^\\s*-\\s*${nome}\\b`, 'i').test(l));
  if (inizio < 0) return '';
  const blocco = [righe[inizio] ?? ''];
  for (let i = inizio + 1; i < righe.length; i++) {
    const l = righe[i] ?? '';
    if (!l.trim() || /^\s*-\s/.test(l) || /^\S/.test(l)) break;
    blocco.push(l);
  }
  return blocco.join('\n');
}

/**
 * Il profilo. Se non è mai stato salvato lo ricava dai due file storici, così chi aggiorna
 * ritrova la sua ricerca nella schermata nuova invece di un modulo vuoto.
 */
export function loadProfile(): Profile {
  if (cache) return cache;
  const saved = readJson<Partial<Profile> | null>(localConfigPath(PROFILE_FILE), null);
  if (saved && Array.isArray(saved.searches)) {
    cache = {
      searches: saved.searches,
      zones: Array.isArray(saved.zones) ? saved.zones : [],
      musts: Array.isArray(saved.musts) ? saved.musts : [],
      notes: typeof saved.notes === 'string' ? saved.notes : '',
    };
    return cache;
  }
  cache = deriveFromLegacy(
    readJson<SearchRow[]>(configReadPath(SEARCHES_FILE), []),
    readText(configReadPath(CRITERIA_FILE)),
  );
  return cache;
}

/** Ricostruisce il profilo dai due file storici. Le zone sono per città quando si capisce. */
export function deriveFromLegacy(searches: SearchRow[], criteria: string): Profile {
  const cities = Array.from(new Set(searches.map((s) => s.city)));
  const zones: CityZones[] = [];

  for (const city of cities) {
    const { keep, avoid } = parseZoneLines(cityBlock(criteria, city));
    if (keep.length || avoid.length) zones.push({ city, keep, avoid });
  }
  // Nessuna riga per città riconosciuta: si tengono comunque le zone trovate, senza attribuzione.
  // Perderle sarebbe il modo peggiore di migrare — sono la parte più laboriosa da riscrivere.
  if (zones.length === 0) {
    const globali = parseZoneLines(criteria);
    if (globali.keep.length || globali.avoid.length) {
      zones.push({ city: cities[0] ?? '', ...globali });
    }
  }

  return { searches, zones, musts: parseMusts(criteria), notes: parseNotes(criteria) };
}

// --- Scrittura -------------------------------------------------------------------------------

/**
 * Il testo che legge l'AI, generato dal profilo.
 *
 * Volutamente nello stesso formato di prima: maiuscole per le sezioni, elenchi con il trattino.
 * Non è estetica — è il formato su cui i criteri sono stati tarati per mesi, e cambiarlo
 * significherebbe rimettere in discussione i voti senza volerlo.
 */
export function renderCriteria(p: Profile): string {
  const out: string[] = [];
  const cities = Array.from(new Set(p.searches.map((s) => s.city))).map(cityLabel);
  if (cities.length) out.push(`CITTÀ: ${cities.join(' oppure ')}.`, '');

  if (p.searches.length) {
    out.push('BUDGET (affitto mensile — sono i tetti, meglio sotto):');
    for (const s of p.searches) {
      const stanze =
        s.minRooms && s.maxRooms
          ? s.minRooms === s.maxRooms
            ? ` (${s.minRooms} locali)`
            : ` (${s.minRooms}-${s.maxRooms} locali)`
          : s.minRooms
            ? ` (almeno ${s.minRooms} locali)`
            : '';
      out.push(`- ${s.label}: ≤ ${s.maxPrice}€${stanze}`);
    }
    out.push('');
  }

  if (p.musts.length) {
    out.push('MUST-HAVE (irrinunciabili):');
    for (const m of p.musts) out.push(`- ${m}`);
    out.push('');
  }

  const conZone = p.zones.filter((z) => z.keep.length || z.avoid.length);
  if (conZone.length) {
    out.push(
      'ZONE — filtro forte ma non assoluto: la qualità della casa pesa. Se il quartiere NON è',
      "indicato, NON scartare per zona (valuta il resto e segnala l'incertezza).",
    );
    for (const z of conZone) {
      // Una riga per elenco, con SCARTA rientrata: è il formato del file storico, ed è anche
      // quello che il lettore qui sopra sa separare senza ambiguità.
      out.push(`- ${cityLabel(z.city)} — TIENI: ${z.keep.join(', ')}.`);
      if (z.avoid.length) out.push(`  SCARTA: ${z.avoid.join(', ')}.`);
    }
    out.push('');
  }

  if (p.notes.trim()) out.push(p.notes.trim(), '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Salva il profilo e rigenera i due file che il resto dell'app legge già.
 *
 * Tutto sotto `data/local/`, che è gitignorato ed escluso dal pacchetto: la ricerca di chi usa
 * l'app non finisce in un commit nemmeno per sbaglio. È esattamente la separazione che era
 * documentata da sempre e che i file di esempio avevano smesso di rispettare.
 */
export async function saveProfile(p: Profile): Promise<void> {
  await writeFileAtomic(localConfigPath(PROFILE_FILE), JSON.stringify(p, null, 2) + '\n');
  await writeFileAtomic(localConfigPath(SEARCHES_FILE), JSON.stringify(p.searches, null, 2) + '\n');
  await writeFileAtomic(localConfigPath(CRITERIA_FILE), renderCriteria(p));
  cache = p;
}

/** `true` quando l'utente ha detto cosa cerca: sotto questa soglia una scansione non ha senso. */
export function profileConfigured(): boolean {
  return loadProfile().searches.length > 0;
}
