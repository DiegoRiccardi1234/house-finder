import { Router } from 'express';
import { publicConnections, saveConnectionConfig, ConnectionConfigSchema } from '../ai/connections.js';
import { connectionDiagnostics, runConnectionTest, TaskRoutingError } from '../ai/task-routing.js';
import { RuntimeError } from '../ai/runtime.js';

export function createConnectionRouter(): Router {
  const router = Router();
  const fail = (res: import('express').Response, error: unknown) => {
    if (error instanceof RuntimeError || error instanceof TaskRoutingError)
      return res.status(error.code === 'connection_missing' ? 404 : 502).json({ ok: false, code: error.code, detail: error.message });
    return res.status(400).json({ ok: false, code: 'invalid_config', detail: 'Configurazione non valida; controlla connessioni e task.' });
  };
  router.get('/ai/connections', (_req, res) => {
    try { res.json(publicConnections()); } catch (error) { fail(res, error); }
  });
  router.put('/ai/connections', async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type application/json richiesto' });
    try {
      const { secrets, ...config } = req.body ?? {};
      ConnectionConfigSchema.parse(config);
      await saveConnectionConfig(config, secrets);
      res.json(publicConnections());
    } catch (error) { fail(res, error); }
  });
  router.get('/ai/connections/:id/diagnostics', async (req, res) => {
    try { res.json(await connectionDiagnostics(req.params.id)); } catch (error) { fail(res, error); }
  });
  router.post('/ai/connections/:id/test', async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type application/json richiesto' });
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try { res.json(await runConnectionTest(req.params.id, controller.signal)); } catch (error) { fail(res, error); }
  });
  return router;
}
