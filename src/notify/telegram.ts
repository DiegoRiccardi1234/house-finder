import type { AiScore, Listing } from '../core/types.js';

const API = 'https://api.telegram.org';

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN mancante (vedi .env / secrets)');
  return t;
}

function chatId(): string {
  const c = process.env.TELEGRAM_CHAT_ID;
  if (!c) throw new Error('TELEGRAM_CHAT_ID mancante (vedi .env / secrets)');
  return c;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function aiLines(ai: AiScore): string[] {
  const stars = `⭐ <b>${ai.score}/100</b> · ${ai.worthVisit ? 'vale una visita ✅' : 'forse no 🤔'}`;
  const verdict = ai.verdict ? `🧠 ${escapeHtml(ai.verdict)}` : '';
  const pros = ai.pros.length ? `✅ ${escapeHtml(ai.pros.join(' · '))}` : '';
  const cons = ai.cons.length ? `⚠️ ${escapeHtml(ai.cons.join(' · '))}` : '';
  return [stars, verdict, pros, cons].filter(Boolean);
}

function caption(label: string, l: Listing, ai?: AiScore): string {
  const price = l.price != null ? `${l.price} €/mese` : 'prezzo n/d';
  const specs = [price, l.sizeSqm ? `${l.sizeSqm} m²` : '', l.rooms ? `${l.rooms} locali` : '']
    .filter(Boolean)
    .join(' · ');
  return [
    `🏠 <b>${escapeHtml(l.title)}</b>`,
    escapeHtml(specs),
    l.zone ? `📍 ${escapeHtml(l.zone)}` : '',
    ...(ai ? aiLines(ai) : []),
    `🔎 ${escapeHtml(label)} · ${escapeHtml(l.source)}`,
    l.url,
  ]
    .filter(Boolean)
    .join('\n');
}

async function tg(method: string, body: Record<string, unknown>): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) console.error(`Telegram ${method} error:`, json.description ?? json);
  return json;
}

/** Manda un annuncio (con voto AI opzionale). Prova con foto; se fallisce, solo testo. */
export async function sendListing(label: string, l: Listing, ai?: AiScore): Promise<void> {
  const text = caption(label, l, ai);
  if (l.thumb) {
    const res = await tg('sendPhoto', {
      chat_id: chatId(),
      photo: l.thumb,
      caption: text,
      parse_mode: 'HTML',
    });
    if (res.ok) return;
  }
  await tg('sendMessage', {
    chat_id: chatId(),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
  });
}

/** Messaggio di servizio (test, riepiloghi). */
export async function sendText(text: string): Promise<void> {
  await tg('sendMessage', { chat_id: chatId(), text });
}
