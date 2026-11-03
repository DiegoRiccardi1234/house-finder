import { z } from 'zod';
import { connectionConfig, connectionKey, type AiConnection, type AiTask } from './connections.js';
import { endpointFor, keyFor } from './credentials.js';
import { buildChainForTask } from './failover.js';
import { getProvider } from './providers/registry.js';
import { createCompatProvider } from './providers/openai-compat.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { specOf } from './providers/catalog.js';
import type { ChatReply, ChatRequest, ProviderId } from './providers/types.js';
import { runtimeChat, runtimeStatus, RuntimeError } from './runtime.js';
import { pickHealthyModels } from './endpoint-health.js';
export { routeConfigured, hasExplicitRoute } from './connections.js';
export type { AiTask } from './connections.js';
export { closeRuntimes } from './runtime.js';

export type TaskChatRequest = Omit<ChatRequest, 'model'> & { model?: string; schema?: z.ZodType; signal?: AbortSignal };
export class TaskRoutingError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
function normalize(reply: ChatReply, request: TaskChatRequest): ChatReply {
  if (reply.finishReason === 'length') throw new TaskRoutingError('truncated', 'Risposta AI troncata: nessun risultato applicato.');
  if (!reply.text.trim()) throw new TaskRoutingError('empty', 'Risposta AI vuota.');
  if (request.schema || request.json) {
    let value: unknown;
    try {
      const raw = reply.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      value = JSON.parse(raw);
    } catch { throw new TaskRoutingError('invalid_json', 'Risposta AI non valida.'); }
    if (request.schema) {
      const parsed = request.schema.safeParse(value);
      if (!parsed.success) throw new TaskRoutingError('invalid_schema', 'Risposta AI non conforme ai dati richiesti.');
      value = parsed.data;
    }
    return { ...reply, text: JSON.stringify(value) };
  }
  return reply;
}
function apiProvider(connection: AiConnection) {
  const provider = (connection.provider ?? 'custom') as ProviderId;
  if (connection.baseUrl || connectionKey(connection.id)) {
    if (provider === 'anthropic') return createAnthropicProvider({ baseURL: connection.baseUrl ?? endpointFor(provider),
      apiKey: connectionKey(connection.id) || keyFor(provider), caps: { ...specOf(provider).caps, vision: connection.vision } });
    return createCompatProvider({ id: provider,
      baseURL: connection.baseUrl ?? endpointFor(provider), apiKey: connectionKey(connection.id) || keyFor(provider),
      caps: { ...specOf(provider).caps, vision: connection.vision } });
  }
  return getProvider(provider);
}
export async function connectionChat(connection: AiConnection, request: TaskChatRequest): Promise<ChatReply> {
  if (!connection.enabled) throw new TaskRoutingError('connection_disabled', 'Connessione disattivata.');
  if (request.signal?.aborted) throw new RuntimeError('cancelled');
  const images = request.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image'));
  if (images && !connection.vision) throw new RuntimeError('unsupported_capability');
  if (connection.kind !== 'api') {
    let outputSchema: Record<string, unknown> | undefined;
    if (request.schema) {
      try { outputSchema = z.toJSONSchema(request.schema, { unrepresentable: 'any' }); }
      catch { throw new TaskRoutingError('invalid_schema', 'Schema richiesto non convertibile.'); }
    }
    return normalize(await runtimeChat(connection, { ...request, model: connection.model ?? request.model ?? '', outputSchema }), request);
  }
  const model = connection.model || request.model || '';
  if (connection.provider === 'openrouter' && !(await pickHealthyModels([model])).includes(model))
    throw new TaskRoutingError('model_unhealthy', 'Il modello scelto non ha endpoint OpenRouter sani.');
  const reply = await apiProvider(connection).chat({ ...request, model });
  if (request.signal?.aborted) throw new RuntimeError('cancelled');
  return normalize(reply, request);
}
export async function taskChat(task: AiTask, request: TaskChatRequest): Promise<ChatReply> {
  const config = connectionConfig();
  const route = config.tasks[task];
  if (!route) {
    const chain = await buildChainForTask(task === 'vision' ? 'vision' : 'reasoning');
    for (const ref of chain) {
      if (request.signal?.aborted) throw new RuntimeError('cancelled');
      try { return normalize(await getProvider(ref.provider).chat({ ...request, model: ref.model }), request); }
      catch (error) { if (request.signal?.aborted) throw new RuntimeError('cancelled'); void error; }
    }
    throw new TaskRoutingError('no_result', 'Nessun motore AI ha completato la richiesta.');
  }
  let last: unknown;
  for (const id of [route.connectionId, ...route.fallbackIds]) {
    const connection = config.connections.find((c) => c.id === id);
    if (!connection) throw new TaskRoutingError('connection_missing', 'Connessione del task non trovata.');
    try { return await connectionChat(connection, request); }
    catch (error) {
      if (request.signal?.aborted || error instanceof RuntimeError && error.code === 'cancelled') throw error;
      last = error;
    }
  }
  if (last instanceof RuntimeError || last instanceof TaskRoutingError) throw last;
  throw new TaskRoutingError('no_result', 'La connessione scelta non ha completato la richiesta. Nessun fallback implicito eseguito.');
}
export async function connectionDiagnostics(id: string) {
  const connection = connectionConfig().connections.find((c) => c.id === id);
  if (!connection) throw new TaskRoutingError('connection_missing', 'Connessione non trovata.');
  if (connection.kind !== 'api') return runtimeStatus(connection);
  try {
    const models = await apiProvider(connection).listModels();
    return { id, kind: connection.kind, installed: true, authenticated: true, ready: connection.enabled,
      models: models.map((model) => ({ id: model, label: model, vision: connection.vision })) };
  } catch {
    return { id, kind: connection.kind, installed: true, authenticated: false, ready: false, models: [],
      code: 'connection_unavailable', detail: 'Endpoint non raggiungibile o accesso non valido.' };
  }
}
export async function runConnectionTest(id: string, signal?: AbortSignal) {
  const connection = connectionConfig().connections.find((c) => c.id === id);
  if (!connection) throw new TaskRoutingError('connection_missing', 'Connessione non trovata.');
  const reply = await connectionChat(connection, { model: connection.model ?? '', signal,
    json: true, schema: z.object({ ok: z.literal(true) }), maxTokens: 200,
    messages: [{ role: 'user', content: 'Test sintetico di connessione. Rispondi solo {"ok":true}.' }] });
  return { ok: true, text: reply.text };
}
