import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { localConfigPath } from '../config/paths.js';
import { writeJsonAtomic } from '../core/atomic.js';
import { isProviderId } from './providers/catalog.js';
import { configuredProviders, isConfigured } from './credentials.js';

export const AI_TASKS = ['scoring', 'vision', 'search', 'zones', 'chat'] as const;
export type AiTask = typeof AI_TASKS[number];
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v));
export const ConnectionSchema = z.object({
  id: Id,
  label: z.string().trim().min(1).max(100),
  kind: z.enum(['codex', 'claude', 'api']),
  model: z.string().trim().max(200).optional(),
  reasoning: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  provider: z.string().refine(isProviderId).optional(),
  baseUrl: z.string().url().refine((v) => {
    const url = new URL(v);
    return (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) &&
      !url.username && !url.password && !url.search && !url.hash;
  },
    'Endpoint HTTP senza credenziali incorporate richiesto').optional(),
  vision: z.boolean().default(false),
  enabled: z.boolean().default(true),
}).strict().superRefine((c, ctx) => {
  if (c.kind === 'api' && !c.provider && !c.baseUrl) ctx.addIssue({ code: 'custom', message: 'Specificare provider o endpoint' });
  if (c.kind === 'claude' && c.vision) ctx.addIssue({ code: 'custom', message: 'Le foto non sono supportate dal runtime Claude Code' });
});
export type AiConnection = z.infer<typeof ConnectionSchema>;
export const RouteSchema = z.object({ connectionId: Id, fallbackIds: z.array(Id).max(10).default([]) }).strict();
export const ConnectionConfigSchema = z.object({
  version: z.literal(1),
  connections: z.array(ConnectionSchema).max(40),
  tasks: z.object({ scoring: RouteSchema.optional(), vision: RouteSchema.optional(), search: RouteSchema.optional(),
    zones: RouteSchema.optional(), chat: RouteSchema.optional() }).strict(),
}).strict().superRefine((config, ctx) => {
  const ids = new Set(config.connections.map((c) => c.id));
  if (ids.size !== config.connections.length) ctx.addIssue({ code: 'custom', message: 'ID connessione duplicato' });
  for (const [task, route] of Object.entries(config.tasks)) {
    if (!route) continue;
    const refs = [route.connectionId, ...route.fallbackIds];
    if (new Set(refs).size !== refs.length || refs.some((id) => !ids.has(id))) ctx.addIssue({ code: 'custom', message: 'Riferimenti task non validi' });
    if (task === 'vision' && refs.some((id) => !config.connections.find((c) => c.id === id)?.vision))
      ctx.addIssue({ code: 'custom', message: 'Il task foto richiede connessioni con immagini abilitate' });
  }
});
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;
const SecretsSchema = z.object({ keys: z.record(Id, z.string().max(10000)) });

function readLocal<T>(name: string, schema: z.ZodType<T>, fallback: T): T {
  let raw: string;
  try { raw = readFileSync(localConfigPath(name), 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('Configurazione connessioni non leggibile.'); }
  const parsed = schema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success) throw new Error('Configurazione connessioni non valida: il file originale è stato conservato.');
  return parsed.data;
}
export function connectionConfig(): ConnectionConfig {
  return readLocal('ai-connections.json', ConnectionConfigSchema, { version: 1, connections: [], tasks: {} });
}
export function connectionKey(id: string): string {
  return readLocal('ai-connection-secrets.json', SecretsSchema, { keys: {} }).keys[id] ?? '';
}
export function publicConnections() {
  const config = connectionConfig();
  return { ...config, connections: config.connections.map((c) => ({ ...c, hasKey: Boolean(connectionKey(c.id)) })) };
}
let writes = Promise.resolve();
export async function saveConnectionConfig(value: unknown, keys?: Record<string, string>): Promise<ConnectionConfig> {
  const config = ConnectionConfigSchema.parse(value);
  const secrets = keys === undefined ? undefined : z.record(Id, z.string().max(10000)).parse(keys);
  if (secrets && Object.keys(secrets).some((id) => !config.connections.some((c) => c.id === id && c.kind === 'api')))
    throw new Error('Le chiavi sono ammesse soltanto sulle connessioni API esistenti.');
  const run = writes.then(async () => {
    if (secrets) {
      const old = readLocal('ai-connection-secrets.json', SecretsSchema, { keys: {} });
      const next = { ...old.keys };
      for (const [id, key] of Object.entries(secrets)) { if (key) next[id] = key; else delete next[id]; }
      await writeJsonAtomic(localConfigPath('ai-connection-secrets.json'), { keys: next });
    }
    await writeJsonAtomic(localConfigPath('ai-connections.json'), config);
  });
  writes = run.catch(() => {});
  await run;
  return config;
}
export function hasExplicitRoute(task: AiTask): boolean { return Boolean(connectionConfig().tasks[task]); }
export function routeConfigured(task: AiTask): boolean {
  const cfg = connectionConfig();
  const route = cfg.tasks[task];
  if (!route) return configuredProviders().length > 0;
  return [route.connectionId, ...route.fallbackIds].some((id) => {
    const c = cfg.connections.find((row) => row.id === id);
    return c?.enabled && (task !== 'vision' || c.vision) &&
      (c.kind !== 'api' || Boolean(c.baseUrl) || Boolean(c.provider && isConfigured(c.provider)));
  });
}
