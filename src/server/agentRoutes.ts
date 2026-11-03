import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { AgentError, AgentService, type AgentDeps } from '../agent/service.js';
import { createAgentMcpServer, safeAgentError } from '../agent/mcp.js';

const COOKIE = 'housefinder_agent_ui';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SESSION_MS = 12 * 60 * 60 * 1000;

/** Validate the literal host and exact origin, including port, before any auth. */
export function localAgentOrigin(req: Request, originRequired = false): string {
  let url: URL;
  try { url = new URL(`${req.protocol}://${req.get('host') ?? ''}`); }
  catch { throw new AgentError('local_host_required', 403); }
  if (!LOCAL_HOSTS.has(url.hostname) || url.username || url.password || url.pathname !== '/') throw new AgentError('local_host_required', 403);
  const remote = req.socket.remoteAddress;
  if (remote && remote !== '::1' && !/^127\./.test(remote) && !/^::ffff:127\./.test(remote)) throw new AgentError('local_client_required', 403);
  const origin = req.get('origin');
  if (origin && origin !== url.origin) throw new AgentError('same_origin_required', 403);
  if (!origin && originRequired) throw new AgentError('origin_required', 403);
  return url.origin;
}

const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const fail = (res: Response, error: unknown): void => {
  const code = safeAgentError(error);
  res.status(error instanceof AgentError ? error.status : 500).json({ error: code });
};

export function createAgentRouter(deps: AgentDeps): {
  router: Router; mcpHandler: RequestHandler; service: AgentService; requireUi: RequestHandler;
} {
  const service = new AgentService(deps);
  const router = Router();
  const sessions = new Map<string, { csrf: string; expires: number }>();
  const purge = (): void => { for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key); };
  const requireUi: RequestHandler = (req, res, next) => {
    try {
      localAgentOrigin(req, !['GET', 'HEAD'].includes(req.method));
      // Capability credentials cannot bootstrap or approve a browser action.
      if (req.get('authorization')) throw new AgentError('ui_session_required', 403);
      purge();
      const token = (req.get('cookie') ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
      const session = sessions.get(token);
      if (!session) throw new AgentError('ui_session_required', 403);
      if (!['GET', 'HEAD'].includes(req.method) && !equal(req.get('x-housefinder-csrf') ?? '', session.csrf)) throw new AgentError('csrf_required', 403);
      next();
    } catch (error) { fail(res, error); }
  };
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res) => { void fn(req, res).catch((error) => fail(res, error)); };
  const requireToken: RequestHandler = (req, res, next) => {
    try {
      localAgentOrigin(req);
      const auth = req.get('authorization') ?? '';
      if (!auth.startsWith('Bearer ') || !service.authenticated(auth.slice(7))) throw new AgentError('agent_token_required', 401);
      next();
    } catch (error) { fail(res, error); }
  };

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/ui/session', (req, res) => {
    try {
      localAgentOrigin(req, true);
      if (req.get('authorization') || req.get('x-housefinder-ui') !== '1' || !req.is('application/json')) throw new AgentError('ui_header_required', 403);
      purge(); if (sessions.size >= 256) throw new AgentError('too_many_ui_sessions', 429);
      const token = randomBytes(32).toString('base64url'); const csrfToken = randomBytes(32).toString('base64url');
      sessions.set(token, { csrf: csrfToken, expires: Date.now() + SESSION_MS });
      res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.protocol === 'https', maxAge: SESSION_MS, path: '/' });
      res.json({ csrfToken });
    } catch (error) { fail(res, error); }
  });
  router.get('/status', requireUi, (_req, res) => res.json({ enabled: true, endpoint: '/mcp', toolsUseAi: false }));
  router.post('/setup', requireUi, wrap(async (req, res) => res.json(await service.setup(localAgentOrigin(req, true)))));
  router.get('/proposals', requireUi, wrap(async (_req, res) => res.json({ proposals: await service.proposals() })));
  for (const [action, accepted] of [['confirm', true], ['reject', false]] as const) {
    router.post(`/proposals/:id/${action}`, requireUi, wrap(async (req, res) => res.json(await service.decide(req.params.id, accepted))));
  }
  router.post('/tools/:name', requireToken, wrap(async (req, res) => res.json(await service.dispatch(req.params.name, req.body?.arguments ?? {}))));

  const nodeHandler = toNodeHandler(createMcpHandler(() => createAgentMcpServer((name, args) => service.dispatch(name, args))));
  const mcpHandler: RequestHandler = (req, res, next) => {
    requireToken(req, res, () => {
      if (req.path !== '/' && req.path !== '') { res.status(404).json({ error: 'unknown_mcp_path' }); return; }
      void nodeHandler(req, res, req.body).catch(next);
    });
  };
  return { router, mcpHandler, service, requireUi };
}
