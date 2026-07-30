import { readFileSync } from 'node:fs';
import { writeFileAtomic } from '../core/atomic.js';
import { localConfigPath } from '../config/paths.js';
import { CATALOG, specOf, isProviderId } from './providers/catalog.js';
import type { ProviderId } from './providers/types.js';

/**
 * Credenziali dei provider AI.
 *
 * Vivono in `data/local/providers.json`, che è già gitignorato e già escluso dal bundle
 * di release: le key non finiscono in un commit nemmeno per sbaglio.
 *
 * Regola d'oro dell'API: **la key non torna mai al client**. Verso la UI escono solo
 * booleani e stati. Niente masking `sk-…abc`: il valore proprio non arriva al browser.
 */
export interface CredFile {
  primary?: ProviderId;
  models?: { reasoning?: string; vision?: string };
  keys?: Partial<Record<ProviderId, string>>;
  endpoints?: Partial<Record<ProviderId, string>>;
}

export type KeyState = 'missing' | 'ok' | 'invalid';

const FILE = 'providers.json';
/** Un 401 può essere transitorio: non si spegne il provider per tutta la sessione. */
const INVALID_TTL_MS = 10 * 60_000;

let cache: CredFile | null = null;
const invalidAt = new Map<ProviderId, number>();

function path(): string {
  return localConfigPath(FILE);
}

export function loadCreds(): CredFile {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(path(), 'utf8')) as CredFile;
  } catch {
    cache = {};
  }
  return cache;
}

export function invalidateCreds(): void {
  cache = null;
}

async function save(next: CredFile): Promise<void> {
  await writeFileAtomic(path(), JSON.stringify(next, null, 2) + '\n');
  cache = next;
}

/** File > env: chi incolla una key nella UI si aspetta che vinca su quella di sistema. */
export function keyFor(id: ProviderId): string {
  const fromFile = loadCreds().keys?.[id];
  if (fromFile) return fromFile;
  return process.env[specOf(id).envVar] ?? '';
}

export function endpointFor(id: ProviderId): string {
  const spec = specOf(id);
  const fromFile = loadCreds().endpoints?.[id];
  if (fromFile) return fromFile;
  if (id === 'custom') return process.env.CUSTOM_BASE_URL ?? '';
  return spec.baseURL;
}

export function isConfigured(id: ProviderId): boolean {
  const spec = specOf(id);
  // `custom` è configurato dall'endpoint, non dalla key: Ollama non ne vuole una.
  if (spec.keyOptional) return Boolean(endpointFor(id));
  return Boolean(keyFor(id));
}

export function keyStateOf(id: ProviderId): KeyState {
  if (!isConfigured(id)) return 'missing';
  const at = invalidAt.get(id);
  if (at && Date.now() - at < INVALID_TTL_MS) return 'invalid';
  return 'ok';
}

export function markKeyInvalid(id: ProviderId): void {
  invalidAt.set(id, Date.now());
}

export function clearKeyInvalid(id: ProviderId): void {
  invalidAt.delete(id);
}

/** Stringa vuota = cancella. `undefined` = non toccare. */
export async function saveKey(id: ProviderId, key: string | undefined, baseUrl?: string): Promise<void> {
  const cur = loadCreds();
  const next: CredFile = {
    ...cur,
    keys: { ...(cur.keys ?? {}) },
    endpoints: { ...(cur.endpoints ?? {}) },
  };
  if (key !== undefined) {
    if (key === '') delete next.keys![id];
    else next.keys![id] = key;
  }
  if (baseUrl !== undefined) {
    if (baseUrl === '') delete next.endpoints![id];
    else next.endpoints![id] = baseUrl;
  }
  clearKeyInvalid(id);
  await save(next);
}

export async function setPrimary(id: ProviderId, model?: string, visionModel?: string): Promise<void> {
  const cur = loadCreds();
  await save({
    ...cur,
    primary: id,
    models: {
      ...(cur.models ?? {}),
      ...(model !== undefined ? { reasoning: model } : {}),
      ...(visionModel !== undefined ? { vision: visionModel } : {}),
    },
  });
}

export function configuredProviders(): ProviderId[] {
  return CATALOG.map((s) => s.id).filter(isConfigured);
}

/** Primario: file → env AI_PROVIDER → primo configurato → openrouter. */
export function primaryProvider(): ProviderId {
  const fromFile = loadCreds().primary;
  if (fromFile && isProviderId(fromFile) && isConfigured(fromFile)) return fromFile;
  const fromEnv = process.env.AI_PROVIDER;
  if (fromEnv && isProviderId(fromEnv) && isConfigured(fromEnv)) return fromEnv;
  return configuredProviders()[0] ?? 'openrouter';
}

/** Primario per primo, poi gli altri configurati: è l'ordine del failover. */
export function providerOrder(): ProviderId[] {
  const primary = primaryProvider();
  const rest = configuredProviders().filter((p) => p !== primary);
  return isConfigured(primary) ? [primary, ...rest] : rest;
}

export function preferredModels(): { reasoning?: string; vision?: string } {
  const m = loadCreds().models ?? {};
  return {
    reasoning: m.reasoning || process.env.AI_MODEL || undefined,
    vision: m.vision || process.env.VISION_MODEL || undefined,
  };
}
