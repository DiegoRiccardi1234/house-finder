import { Router, type Request, type Response } from 'express';
import { CATALOG, isProviderId, specOf } from '../ai/providers/catalog.js';
import { getProvider, invalidateRegistry } from '../ai/providers/registry.js';
import { InvalidKeyError } from '../ai/providers/errors.js';
import type { ProviderId } from '../ai/providers/types.js';
import {
  endpointFor,
  invalidateCreds,
  isConfigured,
  keyStateOf,
  markKeyInvalid,
  preferredModels,
  primaryProvider,
  saveKey,
  setPrimary,
} from '../ai/credentials.js';
import { buildChainForTask, modelsForTask } from '../ai/failover.js';
import { penaltyScore } from '../ai/endpoint-health.js';
import { refKey } from '../ai/providers/types.js';

/**
 * API dei provider AI.
 *
 * Regola che governa tutto il file: **la key non esce mai da qui**. Verso il client vanno
 * solo `configured` e `keyState`. Non si maschera (`sk-…abc`): il valore proprio non viene
 * serializzato, così non può finire in un log, in una cache del browser o in uno screenshot.
 */
export function createAiRouter(): Router {
  const r = Router();

  const requireJson = (req: Request, res: Response): boolean => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Content-Type application/json richiesto' });
      return true;
    }
    return false;
  };

  const parseId = (req: Request, res: Response): ProviderId | null => {
    const id = req.params.id;
    if (!isProviderId(id)) {
      res.status(400).json({ error: 'provider sconosciuto' });
      return null;
    }
    return id;
  };

  r.get('/providers', (_req, res) => {
    const primary = primaryProvider();
    res.json({
      primary,
      models: preferredModels(),
      providers: CATALOG.map((s) => ({
        id: s.id,
        label: s.label,
        free: s.free,
        signup: s.signup,
        hint: s.hint,
        needsEndpoint: s.needsEndpoint,
        keyOptional: s.keyOptional,
        configured: isConfigured(s.id),
        keyState: keyStateOf(s.id),
        baseUrl: endpointFor(s.id),
        isPrimary: s.id === primary,
        caps: { json: s.caps.json, vision: s.caps.vision, health: s.caps.health },
      })),
    });
  });

  /**
   * Salva (o cancella, con key vuota) e prova subito a leggere i modelli: se la lista arriva,
   * la key è buona — è il test di connessione, senza bisogno di un pulsante a parte.
   */
  r.put('/providers/:id/key', async (req, res) => {
    if (requireJson(req, res)) return;
    const id = parseId(req, res);
    if (!id) return;

    const body = req.body as { key?: unknown; baseUrl?: unknown };
    const key = typeof body.key === 'string' ? body.key : undefined;
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : undefined;
    if (key === undefined && baseUrl === undefined) {
      return res.status(400).json({ error: 'niente da salvare' });
    }

    await saveKey(id, key, baseUrl);
    invalidateCreds();
    invalidateRegistry();

    if (!isConfigured(id)) {
      return res.json({ ok: true, configured: false, keyState: 'missing' as const });
    }
    try {
      const models = await getProvider(id).listModels();
      res.json({
        ok: true,
        configured: true,
        keyState: 'ok' as const,
        models,
        recommended: specOf(id).reasoning[0] ?? models[0] ?? null,
      });
    } catch (e) {
      if (e instanceof InvalidKeyError) {
        markKeyInvalid(id);
        return res.json({
          ok: true,
          configured: true,
          keyState: 'invalid' as const,
          error: 'Il provider ha rifiutato la key. Controlla di averla copiata per intero.',
        });
      }
      res.json({
        ok: true,
        configured: true,
        keyState: 'ok' as const,
        error: `Key salvata, ma la lista modelli non è arrivata: ${(e as Error).message}`,
      });
    }
  });

  r.get('/providers/:id/models', async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    if (!isConfigured(id)) return res.status(400).json({ error: 'key_missing' });
    try {
      const models = await getProvider(id).listModels();
      res.json({ models, recommended: specOf(id).reasoning[0] ?? models[0] ?? null });
    } catch (e) {
      if (e instanceof InvalidKeyError) {
        markKeyInvalid(id);
        return res.status(400).json({ error: 'key_invalid' });
      }
      res.status(502).json({ error: (e as Error).message });
    }
  });

  /**
   * I modelli fra cui si può scegliere, per compito.
   *
   * Esiste perché il motore sceglieva benissimo da solo ma non lo raccontava a nessuno: il
   * consigliato era già calcolato e buttato via, e l'unico modo di fissare un modello era la
   * variabile d'ambiente `AI_MODEL`. `auto` viene sempre riportato, anche quando un pin c'è: è
   * su quello che si ripiega, e senza saperlo la voce "Automatico" non vuol dire niente.
   */
  r.get('/models', async (_req, res) => {
    const provider = primaryProvider();
    if (!isConfigured(provider)) {
      return res.json({ configured: false, provider: null, tasks: {} });
    }
    const [reasoning, vision] = await Promise.all([
      modelsForTask('reasoning'),
      specOf(provider).caps.vision
        ? modelsForTask('vision')
        : Promise.resolve({ pinned: null, auto: null, candidates: [] }),
    ]);
    res.json({
      configured: true,
      provider,
      publishesHealth: specOf(provider).caps.health === 'openrouter',
      tasks: {
        reasoning: { label: 'Valutazione degli annunci', ...reasoning },
        vision: { label: 'Lettura delle foto', ...vision },
      },
    });
  });

  r.put('/primary', async (req, res) => {
    if (requireJson(req, res)) return;
    const body = req.body as { provider?: unknown; model?: unknown; visionModel?: unknown };
    if (typeof body.provider !== 'string' || !isProviderId(body.provider)) {
      return res.status(400).json({ error: 'provider sconosciuto' });
    }
    if (!isConfigured(body.provider)) {
      return res.status(400).json({ error: 'provider non configurato' });
    }
    await setPrimary(
      body.provider,
      typeof body.model === 'string' ? body.model : undefined,
      typeof body.visionModel === 'string' ? body.visionModel : undefined,
    );
    invalidateCreds();
    invalidateRegistry();
    res.json({ ok: true });
  });

  /** Salute e catena scelta. Non fa inferenza: non consuma quota. */
  r.get('/health', async (_req, res) => {
    const provider = primaryProvider();
    if (!isConfigured(provider)) {
      return res.json({
        configured: false,
        provider: null,
        model: null,
        probe: 'none' as const,
        chain: [],
        reason: 'Nessun provider AI configurato: gli annunci vengono raccolti ma non valutati.',
      });
    }
    const chain = await buildChainForTask('reasoning');
    res.json({
      configured: true,
      provider,
      model: chain[0]?.model ?? null,
      probe: specOf(provider).caps.health,
      chain: chain.slice(0, 5).map((ref) => {
        const penalty = penaltyScore(refKey(ref));
        return {
          provider: ref.provider,
          model: ref.model,
          uptime5m: null as number | null,
          penalty,
          state: penalty > 0 ? ('penalized' as const) : ('healthy' as const),
        };
      }),
    });
  });

  return r;
}
