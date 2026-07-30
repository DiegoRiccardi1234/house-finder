import type { FinishReason } from './types.js';

/** Risposta 200 ma inutilizzabile: nessuna scelta, o scelta senza contenuto. */
export class EmptyCompletionError extends Error {
  constructor(model: string) {
    super(`[${model}] risposta senza contenuto`);
    this.name = 'EmptyCompletionError';
  }
}

/** Completamento tagliato dal limite di token: il JSON che ne esce non è affidabile. */
export class TruncatedCompletionError extends Error {
  constructor(model: string) {
    super(`[${model}] completamento troncato`);
    this.name = 'TruncatedCompletionError';
  }
}

/** Il provider ha rifiutato la key (401/403 sul singolo provider). */
export class InvalidKeyError extends Error {
  constructor(provider: string) {
    super(`[${provider}] key rifiutata`);
    this.name = 'InvalidKeyError';
  }
}

interface RawChoice {
  message?: { content?: string | null } | null;
  finish_reason?: string | null;
}

/**
 * UNICO punto che legge `choices[0]`. Un payload malformato deve diventare un errore
 * classificato, non un TypeError: altrimenti il modello rotto resta in cima al ranking
 * perché nessuno registra che ha fallito.
 */
export function firstChoice(res: unknown, model: string): { text: string; finishReason: FinishReason } {
  const choices = (res as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new EmptyCompletionError(model);
  const c = choices[0] as RawChoice;
  const text = c?.message?.content ?? '';
  if (!text.trim()) throw new EmptyCompletionError(model);
  return { text, finishReason: normalizeFinish(c?.finish_reason) };
}

export function normalizeFinish(v: string | null | undefined): FinishReason {
  switch (v) {
    case 'stop':
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'content_filter':
    case 'refusal':
      return 'filter';
    default:
      return 'unknown';
  }
}

/** Motivi di penalità: hanno cooldown diversi perché dicono cose diverse. */
export type PenaltyReason = 'length' | 'empty' | 'malformed' | '429' | '403' | 'timeout' | 'json_fail';

/** `null` = non de-rankare: 5xx e problemi di rete non sono colpa del modello. */
export function classifyFailure(e: unknown): PenaltyReason | null {
  if (e instanceof TruncatedCompletionError) return 'length';
  if (e instanceof EmptyCompletionError) return 'malformed';
  const status = (e as { status?: number })?.status;
  if (status === 429) return '429';
  if (status === 403) return '403';
  if (status === 401) return null; // è la key, non il modello
  const msg = String((e as Error)?.message ?? '');
  if (/timeout|timed out|aborted/i.test(msg)) return 'timeout';
  if (status && status >= 500) return null;
  if (/rate.?limit|429/i.test(msg)) return '429';
  return null;
}
