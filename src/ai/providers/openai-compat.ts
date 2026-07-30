import OpenAI from 'openai';
import { firstChoice, InvalidKeyError, TruncatedCompletionError } from './errors.js';
import type { ChatMessage, ChatRequest, ChatReply, Provider, ProviderCaps, ProviderId } from './types.js';

/** Modelli che hanno rifiutato `response_format`: si degrada per il resto della sessione. */
const noJsonMode = new Set<string>();

function toOpenAiMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content } as never;
    const parts = m.content.map((p) =>
      p.type === 'text' ? { type: 'text' as const, text: p.text } : { type: 'image_url' as const, image_url: { url: p.url } },
    );
    return { role: m.role, content: parts } as never;
  });
}

/**
 * Provider per qualunque API OpenAI-compatible: copre 9 degli 11 del catalogo.
 * Il client si costruisce una volta sola e vive nel registry — prima veniva ricreato
 * a ogni chiamata.
 */
export function createCompatProvider(cfg: {
  id: ProviderId;
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  caps: ProviderCaps;
}): Provider {
  const client = new OpenAI({
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    apiKey: cfg.apiKey || 'not-needed',
    defaultHeaders: { 'X-Title': 'House Finder', ...cfg.headers },
    timeout: cfg.caps.timeoutMs,
    // 0 e non 1: il retry dell'SDK duplicherebbe il nostro e ritenterebbe anche i 429,
    // che invece devono fallire subito per far ruotare il modello.
    maxRetries: 0,
  });

  async function create(req: ChatRequest, withJson: boolean) {
    return client.chat.completions.create({
      model: req.model,
      ...(withJson ? { response_format: { type: 'json_object' as const } } : {}),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      messages: toOpenAiMessages(req.messages),
    });
  }

  return {
    id: cfg.id,
    caps: cfg.caps,
    configured: () => Boolean(cfg.apiKey) || cfg.id === 'custom',
    async listModels() {
      try {
        const res = await client.models.list();
        return res.data.map((m) => m.id).sort();
      } catch (e) {
        const status = (e as { status?: number })?.status;
        if (status === 401 || status === 403) throw new InvalidKeyError(cfg.id);
        throw e;
      }
    },
    async chat(req) {
      const wantJson = Boolean(req.json) && cfg.caps.json === 'native' && !noJsonMode.has(req.model);
      let res;
      try {
        res = await create(req, wantJson);
      } catch (e) {
        const status = (e as { status?: number })?.status;
        const msg = String((e as Error)?.message ?? '');
        // Diversi gateway rifiutano response_format: si riprova una volta senza e si ricorda.
        if (wantJson && (status === 400 || status === 422) && /response_format|json_object|json mode/i.test(msg)) {
          noJsonMode.add(req.model);
          res = await create(req, false);
        } else {
          if (status === 401) throw new InvalidKeyError(cfg.id);
          throw e;
        }
      }
      const { text, finishReason } = firstChoice(res, req.model);
      if (finishReason === 'length') throw new TruncatedCompletionError(req.model);
      return { text, finishReason } satisfies ChatReply;
    },
  };
}
