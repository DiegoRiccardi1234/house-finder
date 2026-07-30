/**
 * Tipo neutro delle chiamate AI: il minimo che entrambe le famiglie di API
 * (OpenAI-compatible e Anthropic) sanno esprimere.
 */
export type ProviderId =
  | 'openrouter'
  | 'cerebras'
  | 'groq'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'glm'
  | 'mistral'
  | 'anthropic'
  | 'custom';

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; url: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Chiede JSON: chi non lo supporta nativamente degrada (prefill o solo prompt). */
  json?: boolean;
  maxTokens?: number;
}

export type FinishReason = 'stop' | 'length' | 'filter' | 'unknown';

export interface ChatReply {
  text: string;
  finishReason: FinishReason;
}

export interface ProviderCaps {
  /** `native` = response_format json_object · `prefill` = si forza con un assistant iniziale. */
  json: 'native' | 'prefill' | 'prompt';
  vision: boolean;
  /** Solo OpenRouter pubblica la salute degli endpoint. */
  health: 'openrouter' | 'none';
  timeoutMs: number;
}

export interface Provider {
  readonly id: ProviderId;
  readonly caps: ProviderCaps;
  configured(): boolean;
  chat(req: ChatRequest): Promise<ChatReply>;
  /** Serve anche da test implicito della key: se la lista arriva, la key è buona. */
  listModels(): Promise<string[]>;
}

/** Un modello con il provider che lo serve: lo stesso id può vivere su host diversi. */
export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export const refKey = (r: ModelRef): string => `${r.provider}::${r.model}`;
