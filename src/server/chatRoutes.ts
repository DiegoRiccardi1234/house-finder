import { Router } from 'express';
import { z } from 'zod';
import { ChatService, ChatError, captureChatContext } from '../chat/service.js';
import type { ListingStore } from '../core/store.js';

const Keys = z.array(z.string().min(1).max(400)).max(20);
export function createChatRouter(store: ListingStore, stateDir: string, service = new ChatService(store, stateDir)) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const details: Record<string, string> = {
    cancelled: 'Risposta annullata.', quota_exhausted: 'Quota dell’abbonamento temporaneamente esaurita. Nessun provider alternativo attivato.',
    not_authenticated: 'Accedi al client ufficiale con il tuo account.', subscription_required: 'Serve un account in abbonamento, non una chiave API.',
    not_installed: 'Client ufficiale non installato o non trovato.', tools_disabled: 'Il runtime ha richiesto uno strumento non consentito.',
    timeout: 'Tempo massimo della connessione AI superato.', connection_disabled: 'La connessione del task Chat è disattivata.',
    chat_busy: 'Questa conversazione sta già elaborando una risposta.', chat_not_found: 'Conversazione non trovata.',
    chat_history_invalid: 'Cronologia locale non valida. Il file originale è stato conservato.',
  };
  const wrap = (fn: (req: import('express').Request, res: import('express').Response) => Promise<unknown>) =>
    (req: import('express').Request, res: import('express').Response) => {
      Promise.resolve(fn(req, res)).catch((error: unknown) => {
        const e = error instanceof ChatError ? error : new ChatError('chat_failed', 500);
        if (!res.headersSent && !res.destroyed) res.status(e.status).json({ error: e.code, detail: details[e.code]
          ?? 'La chat non ha completato la richiesta. Controlla la connessione AI e riprova.' });
      });
    };
  router.get('/threads', wrap(async (_req, res) => res.json({ threads: await service.list() })));
  router.post('/threads', wrap(async (_req, res) => res.status(201).json(await service.create())));
  router.delete('/threads/:id', wrap(async (req, res) => { await service.remove(req.params.id); res.json({ ok: true }); }));
  router.post('/context', wrap(async (req, res) => {
    const parsed = Keys.safeParse(req.body?.keys ?? []);
    if (!parsed.success) throw new ChatError('invalid_context');
    res.json(captureChatContext(store, parsed.data));
  }));
  router.post('/threads/:id/messages', wrap(async (req, res) => {
    const body = z.object({ text: z.string().trim().min(1).max(8000), keys: Keys.default([]) }).safeParse(req.body);
    if (!body.success) throw new ChatError('invalid_message');
    res.json(await service.send(req.params.id, body.data.text, body.data.keys));
  }));
  router.post('/threads/:id/cancel', (req, res) => { service.cancel(req.params.id); res.json({ ok: true }); });
  return { router, service };
}
