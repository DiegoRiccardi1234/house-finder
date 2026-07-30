import { z } from 'zod';
import type { AiScore, ContactType, Furnished, Listing, ListingFields } from '../core/types.js';
import { dedupKey } from '../core/state.js';
import { loadCriteria } from '../config/criteria.js';
import { recordPenalty, clearPenalties } from './endpoint-health.js';
import { buildChainForTask } from './failover.js';
import { configuredProviders, markKeyInvalid } from './credentials.js';
import { getProvider } from './providers/registry.js';
import { classifyFailure, InvalidKeyError } from './providers/errors.js';
import { refKey, type ModelRef } from './providers/types.js';

/** Risultato per annuncio: campi normalizzati + giudizio, da UNA sola chiamata AI. */
export interface ScoreResult {
  ai: AiScore;
  fields: ListingFields;
}

// Schema di UN item: campi normalizzati + giudizio. Ogni campo ha `.catch` così un valore
// malformato del modello free diventa null invece di far fallire l'intero gruppo.
const Item = z.object({
  id: z.string(),
  citta: z.string().nullable().catch(null),
  zona: z.string().nullable().catch(null),
  tipologia: z.string().nullable().catch(null),
  prezzo: z.coerce.number().nullable().catch(null),
  spese: z.union([z.string(), z.number()]).nullable().catch(null),
  m2: z.coerce.number().nullable().catch(null),
  locali: z.coerce.number().nullable().catch(null),
  bagni: z.coerce.number().nullable().catch(null),
  piano: z.union([z.string(), z.number()]).nullable().catch(null),
  ascensore: z.union([z.boolean(), z.string()]).nullable().catch(null),
  arredato: z.string().nullable().catch(null),
  classe_energetica: z.union([z.string(), z.number()]).nullable().catch(null),
  riscaldamento: z.string().nullable().catch(null),
  aria_condizionata: z.union([z.boolean(), z.string()]).nullable().catch(null),
  disponibile_da: z.string().nullable().catch(null),
  tipo_contratto: z.string().nullable().catch(null),
  vincoli_inquilino: z.array(z.string()).catch([]),
  contatto: z.string().nullable().catch(null),
  riassunto: z.string().nullable().catch(null),
  score: z.coerce.number().catch(0),
  verdict: z.string().catch(''),
  pros: z.array(z.string()).catch([]),
  cons: z.array(z.string()).catch([]),
  worthVisit: z.boolean().catch(false),
});
type ItemT = z.infer<typeof Item>;
// Array tollerante: gli elementi rotti si scartano uno a uno (safeParse), non fanno cadere tutto.
const Batch = z.object({ scores: z.array(z.unknown()).catch([]) });

const SYSTEM = [
  'Sei un assistente immobiliare che, per ogni annuncio, (1) ESTRAE campi normalizzati dalla descrizione e',
  '(2) lo VALUTA rispetto ai criteri dell\'utente. Rispondi SEMPRE in italiano e SOLO con JSON valido.',
  '',
  'ESTRAZIONE — usa SOLO ciò che è scritto nel testo/descrizione; se un dato non c\'è, metti null (NON inventare).',
  'Campi: citta, zona, tipologia, prezzo(numero), spese, m2(numero), locali(numero), bagni(numero), piano,',
  'ascensore(true/false), arredato("sì"/"parziale"/"no"), classe_energetica, riscaldamento, aria_condizionata(true/false),',
  'disponibile_da, tipo_contratto, vincoli_inquilino(lista, es. "no studenti","solo referenziati","no animali"),',
  'contatto("privato"/"agenzia"), riassunto(1 frase).',
  '',
  'GRIGLIA DI PUNTEGGIO (score 0-100, rispettala):',
  '- Fuori città target, tipologia sbagliata, o prezzo oltre il tetto → ≤ 20.',
  '- NON arredato → ≤ 25 (è un must-have).',
  '- Zona in SCARTA o chiaramente periferica / non in whitelist → ≤ 40, anche se la casa è bella.',
  '- Zona whitelist "ok"/bordo → fino a ~75.  Zona whitelist "core" + arredato + entro budget → 80-100.',
  '- Zona non indicata → non scartare per zona, segnala l\'incertezza nei cons.',
  'I vincoli inquilino in conflitto coi criteri (es. "solo studenti" se non sei studente) pesano nei cons e abbassano lo score.',
  '',
  'Dai anche: verdict (una riga), pros (max 3), cons (max 3), worthVisit (true/false).',
].join('\n');

/** Almeno un provider con credenziali: il nome resta, lo usano server e pipeline. */
export function configured(): boolean {
  return configuredProviders().length > 0;
}

const CHUNK = 10; // annunci per chiamata

function isRetryable(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status && status >= 500) return true;
  const msg = (e as Error)?.message ?? '';
  return /provider returned error|timeout|temporarily/i.test(msg);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normBool(v: boolean | string | null): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  if (/^(sì|si|s|yes|true|con ascensore|presente)/i.test(v.trim())) return true;
  if (/^(no|senza|false|assente)/i.test(v.trim())) return false;
  return null;
}
function normArredato(v: string | null): Furnished | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (/non arred|no\b|vuoto|non ammobil|senza arred/.test(s)) return 'no';
  if (/parzial/.test(s)) return 'parziale';
  if (/arred|ammobil|sì|si\b/.test(s)) return 'sì';
  return null;
}
function normContatto(v: string | null): ContactType | null {
  if (!v) return null;
  if (/agenzia|immobiliar|agency/i.test(v)) return 'agenzia';
  if (/privat/i.test(v)) return 'privato';
  return null;
}
const toStr = (v: string | number | null): string | null => (v == null ? null : String(v).trim() || null);

function toResult(it: ItemT): ScoreResult {
  return {
    ai: { score: it.score, verdict: it.verdict, pros: it.pros, cons: it.cons, worthVisit: it.worthVisit },
    fields: {
      citta: it.citta,
      zona: it.zona,
      tipologia: it.tipologia,
      prezzo: it.prezzo,
      spese: toStr(it.spese),
      m2: it.m2,
      locali: it.locali,
      bagni: it.bagni,
      piano: toStr(it.piano),
      ascensore: normBool(it.ascensore),
      arredato: normArredato(it.arredato),
      classe_energetica: toStr(it.classe_energetica),
      riscaldamento: it.riscaldamento,
      aria_condizionata: normBool(it.aria_condizionata),
      disponibile_da: it.disponibile_da,
      tipo_contratto: it.tipo_contratto,
      vincoli_inquilino: it.vincoli_inquilino,
      contatto: normContatto(it.contatto),
      riassunto: it.riassunto,
    },
  };
}

/**
 * Una chiamata a un modello per un gruppo di annunci; lancia in caso di errore.
 * Troncamento e risposta vuota arrivano già come errori tipizzati dal provider
 * (`TruncatedCompletionError`/`EmptyCompletionError`): il chiamante li classifica.
 */
async function callModel(ref: ModelRef, listings: Listing[]): Promise<Map<string, ScoreResult>> {
  const reply = await getProvider(ref.provider).chat({
    model: ref.model,
    json: true,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(listings) },
    ],
  });
  return parseScoreResponse(reply.text);
}

/**
 * Parsa la risposta (eventualmente "sporca") del modello in una mappa id→ScoreResult.
 * Tollerante: estrae il primo blocco JSON, scarta gli item malformati uno a uno. Esportata per i test.
 */
export function parseScoreResponse(content: string): Map<string, ScoreResult> {
  const parsed = Batch.parse(extractJson(content));
  const map = new Map<string, ScoreResult>();
  for (const raw of parsed.scores) {
    const r = Item.safeParse(raw);
    if (r.success && r.data.id) map.set(r.data.id, toResult(r.data));
  }
  return map;
}

/**
 * Un gruppo (≤CHUNK) attraverso la catena di modelli. Impara dal runtime (CLAUDE.md §79-83):
 * su troncamento/vuoto/429 **penalizza** il modello e passa al successivo (NON ritenta lo stesso);
 * ritenta lo stesso solo su errori transitori non-429 (5xx/timeout).
 */
async function callChunk(listings: Listing[], chain: ModelRef[], log: LogFn = () => {}): Promise<Map<string, ScoreResult>> {
  const warn = (m: string) => {
    console.error(m);
    log(m); // visibile anche nella UI (SSE)
  };
  const MAX_ATTEMPTS = 2; // solo per errori transitori (5xx/rete)
  for (const ref of chain) {
    const label = `${ref.provider}/${ref.model}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const map = await callModel(ref, listings);
        if (map.size === 0) {
          recordPenalty(refKey(ref), 'empty');
          warn(`AI [${label}] risposta VUOTA → penalizzo, passo al prossimo`);
          break;
        }
        return map;
      } catch (e) {
        if (e instanceof InvalidKeyError) {
          markKeyInvalid(ref.provider);
          warn(`AI [${label}] key rifiutata → salto il provider`);
          break;
        }
        const reason = classifyFailure(e);
        if (reason) {
          recordPenalty(refKey(ref), reason);
          warn(`AI [${label}] ${reason} → penalizzo, passo al prossimo`);
          break; // non ritentare chi ha già fallito per una ragione strutturale o di throttle
        }
        const retry = isRetryable(e) && attempt < MAX_ATTEMPTS;
        warn(`AI [${label}] tentativo ${attempt}/${MAX_ATTEMPTS} fallito: ${(e as Error).message}` + (retry ? ' → ritento' : ''));
        if (!retry) break;
        await delay(600 * attempt);
      }
    }
  }
  return new Map();
}

/** Tipo minimo del log iniettabile (allineato a pipeline.LogFn). */
type LogFn = (msg: string) => void;

/**
 * Estrae+valuta TUTTI gli annunci, a gruppi di CHUNK (una chiamata per gruppo, sequenziale).
 * Ritorna mappa id(dedupKey) → { ai, fields }. Se tutto fallisce ritorna mappa vuota (l'AI è un plus).
 */
export async function scoreBatch(listings: Listing[], log: LogFn = () => {}): Promise<Map<string, ScoreResult>> {
  if (!listings.length || !configured()) return new Map();
  clearPenalties(); // le penalità empiriche sono per-task: reset a inizio run
  const out = new Map<string, ScoreResult>();
  const nChunks = Math.ceil(listings.length / CHUNK);
  for (let i = 0; i < listings.length; i += CHUNK) {
    const idx = Math.floor(i / CHUNK) + 1;
    const chunk = listings.slice(i, i + CHUNK);
    // Catena ricalcolata per chunk: riflette le penalità accumulate (health via cache, no rifetch).
    const chain = await buildChainForTask('reasoning');
    const head = chain[0];
    log(
      `[ai] valuto gruppo ${idx}/${nChunks} (${chunk.length} annunci) — modello ${head ? `${head.provider}/${head.model}` : '?'}`,
    );
    const m = await callChunk(chunk, chain, log);
    log(`[ai] gruppo ${idx}/${nChunks}: ${m.size}/${chunk.length} valutati`);
    for (const [k, v] of m) out.set(k, v);
  }
  return out;
}

function buildPrompt(listings: Listing[]): string {
  const items = listings.map((l) => ({
    id: dedupKey(l),
    titolo: l.title,
    prezzo: l.price,
    m2: l.sizeSqm ?? null,
    locali: l.rooms ?? null,
    zona: l.zone ?? null,
    descrizione: l.desc ? l.desc.slice(0, 1500) : null,
    url: l.url,
  }));
  return [
    'CRITERI UTENTE:',
    loadCriteria(),
    '',
    'ANNUNCI (JSON):',
    JSON.stringify(items, null, 2),
    '',
    'Rispondi con: {"scores":[{ "id", ...campi estratti..., "score","verdict","pros":[],"cons":[],"worthVisit" }]}',
    'Usa esattamente gli stessi "id" ricevuti. Un oggetto per ogni annuncio.',
  ].join('\n');
}

/** Estrae il primo blocco JSON da una risposta eventualmente "sporca". */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  return JSON.parse(slice);
}
