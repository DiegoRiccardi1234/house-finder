import type { Source } from '../core/types.js';
import { subito } from './subito.js';
import { immobiliare } from './immobiliare.js';
import { idealista } from './idealista.js';
// import { casa } from './casa.js';

// Portali attivi. Subito/Immobiliare via __NEXT_DATA__; Idealista via DOM (article.item).
//
// NB: Casa.it è disabilitato di default. Usa markup DOM senza __NEXT_DATA__ e
// l'estrazione generica confonde i campi tra card (prezzi errati). Va rifatto
// intercettando la sua API JSON prima di riattivarlo. Vedi src/sources/casa.ts.
export const sources: Source[] = [subito, immobiliare, idealista];
