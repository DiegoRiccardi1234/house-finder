import type { BrowserContext } from 'playwright';

/**
 * Lo slug di una città dell'elenco (`src/config/cities.ts`).
 *
 * Era un'unione di due letterali, `'torino' | 'bari'`, che raccontava una verità del motore ma
 * bloccava il tipo su due valori mentre l'elenco ne ha 107. La validazione vera è a runtime, dove
 * arriva il dato: `cityPath()` solleva su una città che i portali non sanno aprire.
 */
export type City = string;

/** Un profilo di ricerca: cosa cerco, dove, entro che prezzo. */
export interface SearchProfile {
  id: string; // 'torino-bilocale'
  city: City;
  label: string; // 'Torino · bilocale per me'
  maxPrice: number; // €/mese
  minRooms?: number; // locali minimi
  maxRooms?: number; // locali massimi
}

/** Un annuncio normalizzato, comune a tutti i portali. */
export interface Listing {
  source: string; // 'immobiliare' | 'subito' | 'casa'
  id: string; // id univoco dal portale (ricavato dall'URL)
  url: string;
  title: string;
  price: number | null; // €/mese, null se non estraibile
  rooms?: number | null; // locali
  sizeSqm?: number | null; // m²
  zone?: string | null;
  thumb?: string | null; // url immagine anteprima
  desc?: string | null; // testo libero (es. post Facebook) — dato in pasto al giudizio AI
}

/**
 * Un portale via scraping (OPZIONALE). Ogni adapter fa UNA cosa: da un profilo
 * produce annunci. Si testa e si aggiorna in isolamento.
 */
export interface Source {
  name: string;
  /** URL di ricerca già filtrato e ordinato per "più recenti". */
  buildUrl(p: SearchProfile): string;
  /** Apre la pagina, estrae la prima pagina di risultati. */
  fetch(p: SearchProfile, ctx: BrowserContext): Promise<Listing[]>;
}

/**
 * Sorgente via EMAIL (path principale): nessun browser, nessun anti-bot.
 * Legge le mail delle "ricerche salvate" dei portali e ne estrae gli annunci.
 */
export interface EmailSource {
  name: string; // 'immobiliare' | 'idealista' | ...
  /** Riconosce se una mail arriva da questo portale (dal mittente). */
  matchesSender(from: string): boolean;
  /** Estrae gli annunci dal corpo della mail. */
  parse(html: string, text: string): Listing[];
}

/** Giudizio AI su un annuncio rispetto ai criteri dell'utente. */
export interface AiScore {
  score: number; // 0-100
  verdict: string; // una riga
  pros: string[];
  cons: string[];
  worthVisit: boolean;
}

export type Furnished = 'sì' | 'parziale' | 'no';
export type ContactType = 'privato' | 'agenzia';

/**
 * Campi normalizzati estratti dall'AI dalla descrizione: schema UNICO cross-portale.
 * Tutto nullable — l'AI valorizza solo ciò che è scritto, il resto resta null (niente invenzioni).
 */
export interface ListingFields {
  citta: string | null;
  zona: string | null;
  tipologia: string | null; // bilocale, trilocale, stanza, monolocale…
  prezzo: number | null;
  spese: string | null; // condominio/riscaldamento (testo o numero)
  m2: number | null;
  locali: number | null;
  bagni: number | null;
  piano: string | null;
  ascensore: boolean | null;
  arredato: Furnished | null;
  classe_energetica: string | null;
  riscaldamento: string | null;
  aria_condizionata: boolean | null;
  disponibile_da: string | null;
  tipo_contratto: string | null; // transitorio, 4+4, studenti…
  vincoli_inquilino: string[]; // "no studenti", "solo referenziati", "no animali"…
  contatto: ContactType | null;
  riassunto: string | null;
}
