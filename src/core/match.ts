import type { Listing, SearchProfile } from './types.js';

/**
 * Un annuncio rientra nel profilo?
 * Filosofia: in dubbio NON escludere. Se prezzo/locali non sono estraibili,
 * meglio avvisare (lo controllo io) che perdere un annuncio buono.
 */
export function matches(l: Listing, p: SearchProfile): boolean {
  if (l.price != null && l.price > p.maxPrice) return false;
  if (p.minRooms != null && l.rooms != null && l.rooms < p.minRooms) return false;
  if (p.maxRooms != null && l.rooms != null && l.rooms > p.maxRooms) return false;
  return true;
}

// Segnale FORTE: il tag di categoria di Subito che finisce nel titolo (es. "[LocazionepostoautoARG]").
// Subito antepone "Appartamento" pure ai posti auto, quindi qui scartiamo SEMPRE.
const ALWAYS_JUNK = /locazioneposto(auto|moto|furgon)/i;
// Segnali DEBOLI: presenti anche in case vere ("bilocale con box") → scarta solo se non-residenziale.
const WEAK_JUNK = /post[io]\s*(auto|moto|furgon)|box\s*auto|\bautorimessa\b|\bgarage\b|\bmagazzino\b|\bdeposito\b|\bcantina\b/i;
const RESIDENTIAL = /bilocale|trilocale|quadrilocale|monolocale|appartament|attico|villa|loft|stanza|camera|\d+\s*local/i;

/**
 * Scarta i non-residenziali (posti auto, box, garage, magazzini) che i portali mettono tra gli
 * "appartamenti". `ALWAYS_JUNK` = scarto certo; i segnali deboli scartano solo se non ci sono parole
 * chiave residenziali (così "Bilocale con box" resta). Guarda titolo + descrizione.
 */
export function isResidential(l: Listing): boolean {
  const hay = `${l.title} ${l.desc ?? ''}`;
  if (ALWAYS_JUNK.test(hay)) return false;
  if (!WEAK_JUNK.test(hay)) return true;
  return RESIDENTIAL.test(hay);
}
