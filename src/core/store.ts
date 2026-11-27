import type { Listing, AiScore, ListingFields, GeoPoint } from './types.js';
import { dedupKey } from './state.js';
import { writeJsonAtomic, readJsonResilient } from './atomic.js';
import { acquireStoreLock } from './store-lock.js';

export type ListingStatus = 'new' | 'favorite' | 'dismissed' | 'contacted';

/** Record persistito per ogni annuncio: contenuto + voto AI + stato utente. */
export interface StoredListing {
  key: string; // dedupKey (source:id)
  listing: Listing;
  ai: AiScore | null;
  fields: ListingFields | null; // campi normalizzati estratti dall'AI (schema unico)
  visionSummary: string | null; // descrizione foto (stadio vision, Fase 2)
  photos: string[]; // url immagini
  channel: string; // 'email' | 'fb-group' | 'fb-marketplace' | 'subito' | ...
  firstSeen: string; // ISO
  lastSeen: string; // ISO
  status: ListingStatus;
  notified: boolean;
  /** Slug della città a cui appartiene l'annuncio (ricerca, gruppo FB o campo AI). */
  city?: string | null;
  /** Posizione, se nota. */
  geo?: GeoPoint | null;
  /**
   * Scarto deciso da una regola del profilo, non dall'utente. Finché c'è, le regole possono
   * rimettere l'annuncio fra i nuovi se il profilo cambia; una scelta manuale lo cancella.
   */
  auto?: AutoDecision | null;
  /** Casa buona con un vincolo sull'inquilino che ti esclude: vale la pena chiedere. */
  askOwner?: { reason: string } | null;
  /** Lo stesso post pubblicato altrove (altri gruppi FB): gli indirizzi dei doppioni. */
  alsoIn?: string[];
  /**
   * Quando l'utente (UI o agente) ha scelto lo stato a mano. Da lì le regole non toccano più
   * l'annuncio, nemmeno se lo stato scelto è «nuovo»: rimetterlo fra i nuovi è una scelta.
   */
  manualAt?: string;
}

export interface AutoDecision {
  rule: 'tipo' | 'locali' | 'stanza' | 'prezzo' | 'area' | 'inquilino';
  reason: string;
  at: string; // ISO
}

type Patch = Partial<Pick<StoredListing, 'ai' | 'fields' | 'visionSummary' | 'photos' | 'notified' | 'channel' | 'city' | 'geo'>>;

const DEFAULT_PATH = 'state/listings.json';

/**
 * L'annuncio rivisto da un'altra fonte con la stessa chiave (es. un alert email di un annuncio
 * già raccolto dal portale): i dati nuovi vincono, ma quelli che mancano non cancellano i vecchi.
 * Senza, una mail con titolo = testo del link e niente descrizione impoveriva il record.
 */
function mergeListing(prev: Listing | undefined, next: Listing): Listing {
  if (!prev) return next;
  const keep = <T>(n: T | null | undefined, p: T | null | undefined): T | null | undefined =>
    n == null || n === '' ? p : n;
  return {
    ...prev,
    ...next,
    title: next.title?.trim() ? next.title : prev.title,
    price: keep(next.price, prev.price) ?? null,
    rooms: keep(next.rooms, prev.rooms),
    sizeSqm: keep(next.sizeSqm, prev.sizeSqm),
    zone: keep(next.zone, prev.zone),
    thumb: keep(next.thumb, prev.thumb),
    desc: (next.desc?.length ?? 0) >= (prev.desc?.length ?? 0) ? next.desc : prev.desc,
    geo: keep(next.geo, prev.geo),
  };
}

/** Chiavi che inquinerebbero Object.prototype se usate come indice (input da URL /:key). */
function unsafeKey(k: string): boolean {
  return k === '__proto__' || k === 'constructor' || k === 'prototype';
}

/**
 * Persistenza degli annunci trovati (contenuto + voto + stato), su JSON.
 * Ingloba il ruolo dedup di SeenStore: `isNew` = non ancora in archivio.
 * La UI legge da qui (`all`) e aggiorna lo stato (`setStatus`).
 */
export class ListingStore {
  private items: Record<string, StoredListing>;
  private path: string;
  private releaseLock?: () => void;

  private constructor(items: Record<string, StoredListing>, path: string) {
    this.items = items;
    this.path = path;
  }

  static async load(path: string = process.env.LISTINGS_PATH ?? DEFAULT_PATH, options: { exclusive?: boolean } = {}): Promise<ListingStore> {
    // File assente → store vuoto; file corrotto → .bak o errore forte (mai wipe silenzioso).
    const release = options.exclusive ? acquireStoreLock(path) : undefined;
    try {
      const items = await readJsonResilient<Record<string, StoredListing>>(path, {});
      const store = new ListingStore(items, path);
      store.releaseLock = release;
      return store;
    } catch (e) { release?.(); throw e; }
  }

  /** Rilascia il possesso dopo lo spegnimento ordinato; il crash lascia il PID recuperabile. */
  close(): void { this.releaseLock?.(); this.releaseLock = undefined; }

  /** Confine di durabilità: il run può annullare anche lo stato RAM se il save fallisce. */
  checkpoint(): Record<string, StoredListing> { return structuredClone(this.items); }

  restoreCheckpoint(snapshot: Record<string, StoredListing>): void { this.items = structuredClone(snapshot); }

  isNew(l: Listing): boolean {
    return !(dedupKey(l) in this.items);
  }

  get size(): number {
    return Object.keys(this.items).length;
  }

  all(): StoredListing[] {
    return Object.values(this.items);
  }

  get(key: string): StoredListing | undefined {
    if (unsafeKey(key)) return undefined;
    return this.items[key];
  }

  /**
   * Crea o aggiorna il record. Preserva `firstSeen` e lo `status` scelto dall'utente;
   * aggiorna `lastSeen` e i campi passati in `patch`. Se non c'è thumb esplicito e
   * l'annuncio ne ha uno, lo usa come prima foto.
   */
  upsert(l: Listing, nowIso: string, patch: Patch = {}): StoredListing {
    const key = dedupKey(l);
    const prev = this.items[key];
    const rec: StoredListing = {
      key,
      listing: mergeListing(prev?.listing, l),
      ai: patch.ai ?? prev?.ai ?? null,
      fields: patch.fields ?? prev?.fields ?? null,
      visionSummary: patch.visionSummary ?? prev?.visionSummary ?? null,
      photos: patch.photos ?? prev?.photos ?? (l.thumb ? [l.thumb] : []),
      channel: patch.channel ?? prev?.channel ?? l.source,
      firstSeen: prev?.firstSeen ?? nowIso,
      lastSeen: nowIso,
      status: prev?.status ?? 'new',
      notified: patch.notified ?? prev?.notified ?? false,
    };
    // Campi facoltativi: elencati uno per uno, altrimenti la scansione successiva li perderebbe.
    const city = patch.city ?? prev?.city;
    if (city) rec.city = city;
    const geo = patch.geo ?? prev?.geo;
    if (geo) rec.geo = geo;
    if (prev?.auto) rec.auto = prev.auto;
    if (prev?.askOwner) rec.askOwner = prev.askOwner;
    if (prev?.alsoIn?.length) rec.alsoIn = prev.alsoIn;
    if (prev?.manualAt) rec.manualAt = prev.manualAt;
    this.items[key] = rec;
    return rec;
  }

  /**
   * Aggiorna lo stato utente (favorite/dismissed/contacted). Ritorna false se la key non esiste.
   * Una scelta manuale (UI o agente) cancella la decisione automatica: da lì in poi le regole
   * non la toccano più. `askOwner` resta: è un'informazione ("chiedi se affittano a te"), non uno stato.
   */
  setStatus(key: string, status: ListingStatus, nowIso: string = new Date().toISOString()): boolean {
    if (unsafeKey(key)) return false;
    const rec = this.items[key];
    if (!rec) return false;
    rec.status = status;
    rec.manualAt = nowIso;
    delete rec.auto;
    return true;
  }

  /** Svuota l'archivio (per ri-valutare tutto da zero al prossimo run). */
  clear(): void {
    this.items = {};
  }

  /** Rimuove i record che NON passano il predicato. Ritorna quanti ne ha tolti. */
  prune(keep: (rec: StoredListing) => boolean): number {
    let removed = 0;
    for (const key of Object.keys(this.items)) {
      if (!keep(this.items[key])) {
        delete this.items[key];
        removed++;
      }
    }
    return removed;
  }

  /** Applica una trasformazione in-place a ogni record (es. azzerare prezzi brevi). */
  forEach(fn: (rec: StoredListing) => void): void {
    for (const rec of Object.values(this.items)) fn(rec);
  }

  // Serializza i save concorrenti (server + endpoint + run): niente interleaving di syscall.
  private saveChain: Promise<void> = Promise.resolve();
  private mutationChain: Promise<void> = Promise.resolve();
  private pendingMutations = 0;

  /** Comprende anche le operazioni accodate: una scansione non deve sorpassarle. */
  get isMutating(): boolean { return this.pendingMutations > 0; }

  /** Una mutazione API è confermata solo dopo save; gli errori ripristinano RAM prima della prossima. */
  async mutateAndSave<T>(mutate: () => T): Promise<T> {
    this.pendingMutations++;
    const run = this.mutationChain.then(async () => {
      const checkpoint = this.checkpoint();
      try {
        const result = mutate();
        await this.save();
        return result;
      } catch (e) {
        this.restoreCheckpoint(checkpoint);
        throw e;
      }
    });
    this.mutationChain = run.then(() => {}, () => {});
    try { return await run; }
    finally { this.pendingMutations--; }
  }

  async save(): Promise<void> {
    const run = this.saveChain.then(() => this.writeNow());
    this.saveChain = run.catch(() => {}); // la catena prosegue anche se un save fallisce
    return run;
  }

  private async writeNow(): Promise<void> {
    await writeJsonAtomic(this.path, this.items);
  }
}
