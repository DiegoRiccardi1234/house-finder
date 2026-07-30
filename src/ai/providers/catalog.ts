import type { ProviderCaps, ProviderId } from './types.js';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Vuoto = default dell'SDK (OpenAI) oppure fornito dall'utente (custom). */
  baseURL: string;
  envVar: string;
  placeholder: string;
  /** Ha un piano gratuito utilizzabile senza carta. */
  free: boolean;
  signup: string;
  /** Cosa ottieni davvero: è una descrizione, non una promessa. */
  hint: string;
  /** L'utente deve fornire la base URL (Ollama, LM Studio, gateway). */
  needsEndpoint: boolean;
  keyOptional: boolean;
  caps: ProviderCaps;
  reasoning: string[];
  vision: string[];
}

const CLOUD_TIMEOUT = Number(process.env.AI_TIMEOUT_MS ?? 60_000);
/** Un 12B locale scrive un JSON di scoring in 45-60s: con 60s si taglierebbe ogni risposta. */
const LOCAL_TIMEOUT = Number(process.env.AI_LOCAL_TIMEOUT_MS ?? 300_000);

const compat = (over: Partial<ProviderCaps> = {}): ProviderCaps => ({
  json: 'native',
  vision: true,
  health: 'none',
  timeoutMs: CLOUD_TIMEOUT,
  ...over,
});

/**
 * Unica fonte di verità sui provider: la usa il registry, la serve l'API alla UI.
 * Aggiungere un provider OpenAI-compatible = aggiungere una voce qui, zero codice.
 */
export const CATALOG: ProviderSpec[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    placeholder: 'sk-or-v1-…',
    free: true,
    signup: 'https://openrouter.ai/keys',
    hint: 'molti modelli :free · ~200 richieste/giorno · senza carta',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat({ health: 'openrouter' }),
    reasoning: [
      'google/gemma-4-26b-a4b-it:free',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'openai/gpt-oss-120b:free',
    ],
    vision: ['google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    envVar: 'CEREBRAS_API_KEY',
    placeholder: 'csk-…',
    free: true,
    signup: 'https://cloud.cerebras.ai',
    hint: '1M token/giorno · velocissimo · senza carta',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat({ vision: false }),
    reasoning: ['llama-3.3-70b', 'qwen-3-32b', 'gpt-oss-120b'],
    vision: [],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
    placeholder: 'gsk_…',
    free: true,
    signup: 'https://console.groq.com/keys',
    hint: '30 richieste/minuto · molto veloce · senza carta',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat(),
    reasoning: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'],
    vision: ['meta-llama/llama-4-scout-17b-16e-instruct'],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    envVar: 'GEMINI_API_KEY',
    placeholder: 'AIza…',
    free: true,
    signup: 'https://aistudio.google.com/apikey',
    hint: '1500 richieste/giorno su Flash · vision nativa · senza carta',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat(),
    reasoning: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    vision: ['gemini-2.0-flash'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    envVar: 'MISTRAL_API_KEY',
    placeholder: '…',
    free: true,
    signup: 'https://console.mistral.ai/api-keys',
    hint: 'piano Experiment gratuito · senza carta',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat(),
    reasoning: ['mistral-large-latest', 'mistral-small-latest'],
    vision: ['pixtral-12b-latest'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: '',
    envVar: 'OPENAI_API_KEY',
    placeholder: 'sk-…',
    free: false,
    signup: 'https://platform.openai.com/api-keys',
    hint: 'a consumo, serve credito',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat(),
    reasoning: ['gpt-4o-mini', 'gpt-4o'],
    vision: ['gpt-4o-mini'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    envVar: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-…',
    free: false,
    signup: 'https://platform.deepseek.com/api_keys',
    hint: 'a consumo, molto economico',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat({ vision: false }),
    reasoning: ['deepseek-chat'],
    vision: [],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    baseURL: 'https://api.x.ai/v1',
    envVar: 'XAI_API_KEY',
    placeholder: 'xai-…',
    free: false,
    signup: 'https://console.x.ai',
    hint: 'a consumo, serve credito',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat(),
    reasoning: ['grok-3-mini', 'grok-3'],
    vision: ['grok-2-vision-1212'],
  },
  {
    id: 'glm',
    label: 'Z.ai (GLM)',
    baseURL: 'https://api.z.ai/api/paas/v4',
    envVar: 'GLM_API_KEY',
    placeholder: '…',
    free: false,
    signup: 'https://z.ai/manage-apikey/apikey-list',
    hint: 'a consumo · la console cinese usa una base URL diversa',
    needsEndpoint: false,
    keyOptional: false,
    caps: compat(),
    reasoning: ['glm-4.6', 'glm-4.5-air'],
    vision: ['glm-4.5v'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseURL: 'https://api.anthropic.com/v1',
    envVar: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-…',
    free: false,
    signup: 'https://console.anthropic.com/settings/keys',
    hint: 'a consumo, serve credito',
    needsEndpoint: false,
    keyOptional: false,
    // Non ha response_format: il JSON si ottiene col prefill dell'assistant.
    caps: { json: 'prefill', vision: true, health: 'none', timeoutMs: CLOUD_TIMEOUT },
    reasoning: ['claude-3-5-haiku-latest', 'claude-sonnet-4-5'],
    vision: ['claude-3-5-haiku-latest'],
  },
  {
    id: 'custom',
    label: 'Endpoint personale (Ollama, LM Studio…)',
    baseURL: '',
    envVar: 'CUSTOM_API_KEY',
    placeholder: 'facoltativa',
    free: true,
    signup: 'https://ollama.com/download',
    hint: 'qualsiasi endpoint OpenAI-compatible · gira in locale · nessun costo',
    needsEndpoint: true,
    keyOptional: true,
    caps: { json: 'native', vision: false, health: 'none', timeoutMs: LOCAL_TIMEOUT },
    reasoning: [],
    vision: [],
  },
];

const BY_ID = new Map(CATALOG.map((s) => [s.id, s]));

export function specOf(id: ProviderId): ProviderSpec {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`provider sconosciuto: ${id}`);
  return s;
}

export function isProviderId(v: string): v is ProviderId {
  return BY_ID.has(v as ProviderId);
}
