/**
 * Le città in cui si può cercare.
 *
 * Prima ogni portale aveva la sua mappa da due voci, scritta a mano:
 *
 * ```ts
 * const CITY_PATH = { torino: 'annunci-piemonte/affitto/appartamenti/torino/torino/', … };
 * ```
 *
 * E la schermata lasciava scrivere la città a mano. Chi digitava "Milano" salvava senza un
 * avviso, e lo scraper chiedeva `https://www.subito.it/undefined` — un guasto che non produce
 * errori, solo zero annunci. Qui la città diventa **un dato**: si aggiunge una riga, non si
 * modificano tre file di codice.
 *
 * I 107 capoluoghi di provincia sono l'insieme giusto da cui partire perché su di essi il nome
 * del comune coincide con quello della provincia — che è esattamente ciò che serve a Subito per
 * comporre l'indirizzo.
 *
 * **I percorsi sono composti per regola, non verificati per fede**: `npm run try:cities` prova
 * ogni città sui tre portali e dice quali rispondono. Dove la regola non basta (nomi con
 * apostrofi, province dal nome diverso) si mette un `override` per quel portale — misurato, non
 * indovinato.
 */

export interface City {
  /** Chiave stabile: finisce nella configurazione e negli id delle ricerche. */
  slug: string;
  label: string;
  /** Slug della regione, come lo usa Subito nel primo segmento. */
  region: string;
  /** Slug della provincia. Sui capoluoghi coincide col comune, tranne dove non coincide. */
  province: string;
  /** Percorsi già pronti, quando la regola generale non azzecca quel portale. */
  override?: Partial<Record<'subito' | 'immobiliare' | 'idealista', string>>;
}

/** `[slug, label, regione, provincia?]` — provincia omessa quando è uguale allo slug. */
type Row = [string, string, string, string?];

const ROWS: Row[] = [
  // Abruzzo
  ['laquila', "L'Aquila", 'abruzzo'],
  ['chieti', 'Chieti', 'abruzzo'],
  ['pescara', 'Pescara', 'abruzzo'],
  ['teramo', 'Teramo', 'abruzzo'],
  // Basilicata
  ['potenza', 'Potenza', 'basilicata'],
  ['matera', 'Matera', 'basilicata'],
  // Calabria
  ['catanzaro', 'Catanzaro', 'calabria'],
  ['cosenza', 'Cosenza', 'calabria'],
  ['crotone', 'Crotone', 'calabria'],
  ['reggio-calabria', 'Reggio Calabria', 'calabria'],
  ['vibo-valentia', 'Vibo Valentia', 'calabria'],
  // Campania
  ['napoli', 'Napoli', 'campania'],
  ['avellino', 'Avellino', 'campania'],
  ['benevento', 'Benevento', 'campania'],
  ['caserta', 'Caserta', 'campania'],
  ['salerno', 'Salerno', 'campania'],
  // Emilia-Romagna
  ['bologna', 'Bologna', 'emilia-romagna'],
  ['ferrara', 'Ferrara', 'emilia-romagna'],
  ['forli', 'Forlì', 'emilia-romagna', 'forli-cesena'],
  ['cesena', 'Cesena', 'emilia-romagna', 'forli-cesena'],
  ['modena', 'Modena', 'emilia-romagna'],
  ['parma', 'Parma', 'emilia-romagna'],
  ['piacenza', 'Piacenza', 'emilia-romagna'],
  ['ravenna', 'Ravenna', 'emilia-romagna'],
  ['reggio-emilia', 'Reggio Emilia', 'emilia-romagna'],
  ['rimini', 'Rimini', 'emilia-romagna'],
  // Friuli-Venezia Giulia
  ['trieste', 'Trieste', 'friuli-venezia-giulia'],
  ['gorizia', 'Gorizia', 'friuli-venezia-giulia'],
  ['pordenone', 'Pordenone', 'friuli-venezia-giulia'],
  ['udine', 'Udine', 'friuli-venezia-giulia'],
  // Lazio
  ['roma', 'Roma', 'lazio'],
  ['frosinone', 'Frosinone', 'lazio'],
  ['latina', 'Latina', 'lazio'],
  ['rieti', 'Rieti', 'lazio'],
  ['viterbo', 'Viterbo', 'lazio'],
  // Liguria
  ['genova', 'Genova', 'liguria'],
  ['imperia', 'Imperia', 'liguria'],
  ['la-spezia', 'La Spezia', 'liguria'],
  ['savona', 'Savona', 'liguria'],
  // Lombardia
  ['milano', 'Milano', 'lombardia'],
  ['bergamo', 'Bergamo', 'lombardia'],
  ['brescia', 'Brescia', 'lombardia'],
  ['como', 'Como', 'lombardia'],
  ['cremona', 'Cremona', 'lombardia'],
  ['lecco', 'Lecco', 'lombardia'],
  ['lodi', 'Lodi', 'lombardia'],
  ['mantova', 'Mantova', 'lombardia'],
  ['monza', 'Monza', 'lombardia', 'monza-e-della-brianza'],
  ['pavia', 'Pavia', 'lombardia'],
  ['sondrio', 'Sondrio', 'lombardia'],
  ['varese', 'Varese', 'lombardia'],
  // Marche
  ['ancona', 'Ancona', 'marche'],
  ['ascoli-piceno', 'Ascoli Piceno', 'marche'],
  ['fermo', 'Fermo', 'marche'],
  ['macerata', 'Macerata', 'marche'],
  ['pesaro', 'Pesaro', 'marche', 'pesaro-e-urbino'],
  // Molise
  ['campobasso', 'Campobasso', 'molise'],
  ['isernia', 'Isernia', 'molise'],
  // Piemonte
  ['torino', 'Torino', 'piemonte'],
  ['alessandria', 'Alessandria', 'piemonte'],
  ['asti', 'Asti', 'piemonte'],
  ['biella', 'Biella', 'piemonte'],
  ['cuneo', 'Cuneo', 'piemonte'],
  ['novara', 'Novara', 'piemonte'],
  ['verbania', 'Verbania', 'piemonte', 'verbano-cusio-ossola'],
  ['vercelli', 'Vercelli', 'piemonte'],
  // Puglia
  ['bari', 'Bari', 'puglia'],
  ['barletta', 'Barletta', 'puglia', 'barletta-andria-trani'],
  ['andria', 'Andria', 'puglia', 'barletta-andria-trani'],
  ['trani', 'Trani', 'puglia', 'barletta-andria-trani'],
  ['brindisi', 'Brindisi', 'puglia'],
  ['foggia', 'Foggia', 'puglia'],
  ['lecce', 'Lecce', 'puglia'],
  ['taranto', 'Taranto', 'puglia'],
  // Sardegna
  ['cagliari', 'Cagliari', 'sardegna'],
  ['nuoro', 'Nuoro', 'sardegna'],
  ['oristano', 'Oristano', 'sardegna'],
  ['sassari', 'Sassari', 'sardegna'],
  // Carbonia (capoluogo del Sud Sardegna) è fuori dall'elenco: su Subito non esiste una pagina
  // di ricerca per quel comune, in nessuna delle forme provate da `try:cities`. Meglio non
  // offrire una città che su un portale su tre non troverebbe mai niente.
  // Sicilia
  ['palermo', 'Palermo', 'sicilia'],
  ['agrigento', 'Agrigento', 'sicilia'],
  ['caltanissetta', 'Caltanissetta', 'sicilia'],
  ['catania', 'Catania', 'sicilia'],
  ['enna', 'Enna', 'sicilia'],
  ['messina', 'Messina', 'sicilia'],
  ['ragusa', 'Ragusa', 'sicilia'],
  ['siracusa', 'Siracusa', 'sicilia'],
  ['trapani', 'Trapani', 'sicilia'],
  // Toscana
  ['firenze', 'Firenze', 'toscana'],
  ['arezzo', 'Arezzo', 'toscana'],
  ['grosseto', 'Grosseto', 'toscana'],
  ['livorno', 'Livorno', 'toscana'],
  ['lucca', 'Lucca', 'toscana'],
  ['massa', 'Massa', 'toscana', 'massa-carrara'],
  ['pisa', 'Pisa', 'toscana'],
  ['pistoia', 'Pistoia', 'toscana'],
  ['prato', 'Prato', 'toscana'],
  ['siena', 'Siena', 'toscana'],
  // Trentino-Alto Adige
  ['trento', 'Trento', 'trentino-alto-adige'],
  ['bolzano', 'Bolzano', 'trentino-alto-adige'],
  // Umbria
  ['perugia', 'Perugia', 'umbria'],
  ['terni', 'Terni', 'umbria'],
  // Valle d'Aosta
  ['aosta', 'Aosta', 'valle-d-aosta'],
  // Veneto
  ['venezia', 'Venezia', 'veneto'],
  ['belluno', 'Belluno', 'veneto'],
  ['padova', 'Padova', 'veneto'],
  ['rovigo', 'Rovigo', 'veneto'],
  ['treviso', 'Treviso', 'veneto'],
  ['verona', 'Verona', 'veneto'],
  ['vicenza', 'Vicenza', 'veneto'],
];

/**
 * Le eccezioni alla regola, **misurate** con `npm run try:cities`, non dedotte.
 *
 * Subito non segue il nome ufficiale della provincia: L'Aquila ha l'apostrofo che diventa un
 * trattino, Reggio si chiama "di Calabria" e "nell'Emilia" nel comune ma non nella provincia,
 * Pesaro sta in "pesaro-urbino" senza la "e", e Monza ignora del tutto "e della Brianza".
 * Ognuna di queste righe è un 404 incontrato davvero.
 */
const OVERRIDES: Record<string, City['override']> = {
  laquila: { subito: 'annunci-abruzzo/affitto/appartamenti/l-aquila/l-aquila/' },
  'reggio-calabria': {
    subito: 'annunci-calabria/affitto/appartamenti/reggio-calabria/reggio-di-calabria/',
  },
  'reggio-emilia': {
    subito: 'annunci-emilia-romagna/affitto/appartamenti/reggio-emilia/reggio-nell-emilia/',
  },
  pesaro: { subito: 'annunci-marche/affitto/appartamenti/pesaro-urbino/pesaro/' },
  monza: { subito: 'annunci-lombardia/affitto/appartamenti/monza/monza/' },
};

export const CITIES: readonly City[] = ROWS.map(([slug, label, region, province]) => ({
  slug,
  label,
  region,
  province: province ?? slug,
  ...(OVERRIDES[slug] ? { override: OVERRIDES[slug] } : {}),
}));

const BY_SLUG = new Map(CITIES.map((c) => [c.slug, c] as const));

export function findCity(slug: string): City | undefined {
  return BY_SLUG.get(slug.trim().toLowerCase());
}

export function isKnownCity(slug: string): boolean {
  return BY_SLUG.has(slug.trim().toLowerCase());
}

/** Etichetta leggibile; per una città sconosciuta si restituisce ciò che c'è, non "undefined". */
export function labelOf(slug: string): string {
  return findCity(slug)?.label ?? slug;
}

export class UnknownCityError extends Error {
  constructor(public readonly slug: string) {
    super(
      `Città non riconosciuta: "${slug}". Scegline una dall'elenco in Config → La tua ricerca.`,
    );
    this.name = 'UnknownCityError';
  }
}

/**
 * Il percorso di ricerca per un portale.
 *
 * Solleva se la città non è nell'elenco. È il punto in cui prima nasceva silenziosamente un
 * `https://www.subito.it/undefined`: meglio una scansione che si ferma dicendo perché di una
 * che gira a vuoto e non trova niente.
 */
export function cityPath(slug: string, portal: 'subito' | 'immobiliare' | 'idealista'): string {
  const c = findCity(slug);
  if (!c) throw new UnknownCityError(slug);
  const custom = c.override?.[portal];
  if (custom) return custom;
  switch (portal) {
    case 'subito':
      return `annunci-${c.region}/affitto/appartamenti/${c.province}/${c.slug}/`;
    case 'immobiliare':
      return `affitto-case/${c.slug}/`;
    case 'idealista':
      return `affitto-case/${c.slug}-${c.province}/`;
  }
}
