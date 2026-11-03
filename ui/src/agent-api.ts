export type AiTask = 'scoring' | 'vision' | 'search' | 'zones' | 'chat';
export const TASK_LABELS: Record<AiTask, string> = { scoring: 'Valutazione annunci', vision: 'Lettura foto', search: 'Ricerca da testo', zones: 'Suggerimento quartieri', chat: 'Chat sugli annunci' };
export interface Connection { id: string; label: string; kind: 'codex' | 'claude' | 'api'; model?: string;
  reasoning?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; provider?: string; baseUrl?: string; vision: boolean; enabled: boolean; hasKey?: boolean }
export interface Connections { version: 1; connections: Connection[]; tasks: Partial<Record<AiTask, { connectionId: string; fallbackIds: string[] }>> }
export interface Proposal { id: string; kind: string; state: string; payload: unknown; createdAt: string; error?: string }
export interface ChatContext { capturedAt: string; profile: { searches: { label: string; maxPrice: number }[] }; stats: { total: number }; listings: { key: string; title: string; url: string; price: number | null; zone: string | null; description: string; score: number | null }[] }
export interface ChatThread { id: string; title: string; createdAt: string; updatedAt: string; messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; context?: ChatContext }[]; busy?: boolean; lastError?: string }

let session: Promise<string> | null = null;
async function csrf(): Promise<string> {
  session ??= fetch('/api/agent/ui/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HouseFinder-UI': '1' }, body: '{}' })
    .then(async (response) => { if (!response.ok) throw new Error('Sessione locale non disponibile. Ricarica la pagina.'); return (await response.json() as { csrfToken: string }).csrfToken; })
    .catch((error: unknown) => { session = null; throw error; });
  return session;
}
export async function agentJson<T>(url: string, method = 'GET', body?: unknown, retry = true): Promise<T> {
  const token = await csrf();
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-HouseFinder-CSRF': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json() as T & { error?: string; detail?: string };
  if (!response.ok) {
    if (retry && response.status === 403 && ['ui_session_required', 'csrf_required'].includes(data.error ?? '')) {
      session = null; return agentJson<T>(url, method, body, false);
    }
    throw new Error(data.detail ?? data.error ?? 'Richiesta non completata.');
  }
  return data;
}
