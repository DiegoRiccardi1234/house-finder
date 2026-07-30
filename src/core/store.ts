import type { Listing, AiScore, ListingFields } from './types.js';
import { dedupKey } from './state.js';
import { writeFileAtomic, readJsonResilient } from './atomic.js';

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
}

type Patch = Partial<Pick<StoredListing, 'ai' | 'fields' | 'visionSummary' | 'photos' | 'notified' | 'channel'>>;

const DEFAULT_PATH = 'state/listings.json';

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

  private constructor(items: Record<string, StoredListing>, path: string) {
    this.items = items;
    this.path = path;
  }

  static async load(path: string = process.env.LISTINGS_PATH ?? DEFAULT_PATH): Promise<ListingStore> {
    // File assente → store vuoto; file corrotto → .bak o errore forte (mai wipe silenzioso).
    const items = await readJsonResilient<Record<string, StoredListing>>(path, {});
    return new ListingStore(items, path);
  }

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
      listing: l,
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
    this.items[key] = rec;
    return rec;
  }

  /** Aggiorna lo stato utente (favorite/dismissed/contacted). Ritorna false se la key non esiste. */
  setStatus(key: string, status: ListingStatus): boolean {
    if (unsafeKey(key)) return false;
    const rec = this.items[key];
    if (!rec) return false;
    rec.status = status;
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

  async save(): Promise<void> {
    const run = this.saveChain.then(() => this.writeNow());
    this.saveChain = run.catch(() => {}); // la catena prosegue anche se un save fallisce
    return run;
  }

  private async writeNow(): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify(this.items, null, 2) + '\n');
  }
}
