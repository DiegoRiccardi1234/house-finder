import { InvalidKeyError, normalizeFinish, EmptyCompletionError, TruncatedCompletionError } from './errors.js';
import type { ChatMessage, ChatRequest, Provider, ProviderCaps } from './types.js';

/** Blocco di contenuto nel formato Anthropic (diverso da quello OpenAI). */
type ImageSource =
  | { type: 'url'; url: string }
  | { type: 'base64'; media_type: string; data: string };
type Block = { type: 'text'; text: string } | { type: 'image'; source: ImageSource };

/**
 * Le foto arrivano come data URI (la pipeline le copia in locale: le CDN dei portali bloccano
 * l'hotlink). Anthropic non accetta un data URI dentro `source.url`: vuole il base64 spacchettato
 * in `media_type` + `data`.
 */
function toImageSource(url: string): ImageSource {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return m ? { type: 'base64', media_type: m[1], data: m[2] } : { type: 'url', url };
}

function toBlocks(content: ChatMessage['content']): Block[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((p) =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', source: toImageSource(p.url) },
  );
}

/**
 * Adapter Anthropic su `fetch`: nessuna dipendenza in più.
 *
 * Due differenze irriducibili dalla famiglia OpenAI:
 * - il messaggio `system` è un campo a sé, non un elemento di `messages`;
 * - non esiste `response_format`. Per ottenere JSON si usa il **prefill**: si accoda un
 *   messaggio assistant che inizia con `{`, e la graffa si ri-antepone alla risposta.
 *   Costa meno del tool-use e non obbliga a riscrivere lo schema di validazione.
 */
export function createAnthropicProvider(cfg: {
  baseURL: string;
  apiKey: string;
  caps: ProviderCaps;
}): Provider {
  async function call(path: string, init: RequestInit): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), cfg.caps.timeoutMs);
    try {
      const res = await fetch(`${cfg.baseURL}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          ...(init.headers ?? {}),
        },
      });
      if (res.status === 401 || res.status === 403) throw new InvalidKeyError('anthropic');
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`anthropic HTTP ${res.status}: ${body.slice(0, 200)}`);
        (err as { status?: number }).status = res.status;
        throw err;
      }
      return res.json();
    } finally {
      clearTimeout(t);
    }
  }

  return {
    id: 'anthropic',
    caps: cfg.caps,
    configured: () => Boolean(cfg.apiKey),
    async listModels() {
      const j = (await call('/models?limit=100', { method: 'GET' })) as { data?: { id: string }[] };
      return (j.data ?? []).map((m) => m.id).sort();
    },
    async chat(req: ChatRequest) {
      const system = req.messages
        .filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n\n');
      const rest = req.messages.filter((m) => m.role !== 'system');
      const messages = rest.map((m) => ({ role: m.role, content: toBlocks(m.content) }));

      const prefill = Boolean(req.json);
      // Il prefill non può terminare con spazi: Anthropic rifiuta il messaggio.
      if (prefill) messages.push({ role: 'assistant', content: [{ type: 'text', text: '{' }] });

      const j = (await call('/messages', {
        method: 'POST',
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens ?? 4096,
          ...(system ? { system } : {}),
          messages,
        }),
      })) as { content?: { type: string; text?: string }[]; stop_reason?: string };

      const text = (j.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      const finishReason = normalizeFinish(j.stop_reason);
      if (finishReason === 'length') throw new TruncatedCompletionError(req.model);
      if (!text.trim()) throw new EmptyCompletionError(req.model);
      return { text: prefill ? `{${text}` : text, finishReason };
    },
  };
}
