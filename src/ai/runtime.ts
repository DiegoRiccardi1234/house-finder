import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { AiConnection } from './connections.js';
import type { ChatReply, ChatRequest } from './providers/types.js';

const MESSAGES = {
  not_installed: 'Client ufficiale non installato o non trovato.',
  not_authenticated: 'Accedi al client ufficiale con il tuo account.',
  subscription_required: 'Serve un account in abbonamento, non una chiave API.',
  quota_exhausted: 'Quota dell’abbonamento temporaneamente esaurita.',
  timeout: 'Tempo massimo del runtime superato.', cancelled: 'Richiesta annullata.',
  protocol_error: 'Risposta del runtime non utilizzabile.', tools_disabled: 'Il runtime ha richiesto uno strumento non consentito.',
  unsupported_capability: 'Questo runtime non supporta le immagini richieste.',
  truncated: 'Risposta del runtime troncata: risultato non applicato.',
} as const;
export class RuntimeError extends Error {
  constructor(public readonly code: keyof typeof MESSAGES) { super(MESSAGES[code]); }
}
function safeError(value: unknown): RuntimeError {
  const text = JSON.stringify(value)?.toLowerCase() ?? '';
  if (/quota|usage.?limit|rate.?limit|429|budgetexceeded/.test(text)) return new RuntimeError('quota_exhausted');
  if (/unauthori|not.?logged|not.?authenticated|authentication|login required|401/.test(text)) return new RuntimeError('not_authenticated');
  if (/cancel|interrupt/.test(text)) return new RuntimeError('cancelled');
  if (/contextwindowexceeded|max_tokens|max_output_tokens|length/.test(text)) return new RuntimeError('truncated');
  return new RuntimeError('protocol_error');
}
export function runtimeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (['CODEX_HOME', 'CLAUDE_CONFIG_DIR'].includes(key.toUpperCase())) { env[key] = value; continue; }
    if (/^(OPENAI_|ANTHROPIC_|CODEX_|CLAUDE_)/i.test(key) || /API_KEY|AUTH_TOKEN|ACCESS_TOKEN|BEARER_TOKEN|SESSION_TOKEN|SECRET_ACCESS_KEY/i.test(key) ||
      /^(NODE_OPTIONS|NODE_PATH|RUST_LOG|RUST_BACKTRACE|PYTHONPATH)$/i.test(key)) continue;
    env[key] = value;
  }
  return { ...env, NO_COLOR: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
}
function findNative(root: string, filename: string, depth = 0): string | undefined {
  if (!existsSync(root) || depth > 7) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename) return path;
    if (entry.isDirectory()) { const found = findNative(path, filename, depth + 1); if (found) return found; }
  }
}
export function findRuntimeCli(kind: 'codex' | 'claude'): string | undefined {
  const paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const filename = process.platform === 'win32' ? `${kind}.exe` : kind;
  for (const dir of paths) { const path = join(dir, filename); if (existsSync(path)) return path; }
  if (process.platform === 'win32' && kind === 'codex') {
    for (const dir of paths) {
      for (const root of [join(dir, 'node_modules', '@openai', 'codex'), join(dir, 'node_modules', '@openai', 'codex-win32-x64')]) {
        const found = findNative(root, filename); if (found) return found;
      }
    }
  }
  if (process.platform === 'win32' && kind === 'claude') {
    const native = join(homedir(), '.local', 'bin', 'claude.exe'); if (existsSync(native)) return native;
  }
  return undefined;
}
export function codexOverrides(configText?: string): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    model_provider: 'openai', forced_login_method: 'chatgpt', web_search: 'disabled', approval_policy: 'never',
    sandbox_mode: 'read-only', project_doc_max_bytes: 0, developer_instructions: '', 'history.persistence': 'none',
    'analytics.enabled': false, notify: [],
  };
  for (const feature of ['shell_tool', 'unified_exec', 'multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'hooks',
    'skill_mcp_dependency_install', 'skill_search', 'shell_snapshot', 'memories', 'code_mode', 'code_mode_host', 'computer_use'])
    settings[`features.${feature}`] = false;
  settings['features.skip_host_skill_discovery'] = true;
  let raw = configText;
  if (raw === undefined) {
    try { raw = readFileSync(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new RuntimeError('protocol_error'); }
  }
  let config: Record<string, unknown>;
  try { config = raw ? parseToml(raw) : {}; } catch { throw new RuntimeError('protocol_error'); }
  const profiles = config.profiles && typeof config.profiles === 'object' ? Object.values(config.profiles) : [];
  for (const value of [config, ...profiles]) {
    if (!value || typeof value !== 'object') continue;
    const servers = (value as Record<string, unknown>).mcp_servers;
    if (!servers || typeof servers !== 'object') continue;
    for (const name of Object.keys(servers)) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new RuntimeError('protocol_error');
      settings[`mcp_servers.${name}.enabled`] = false;
    }
  }
  return settings;
}
export interface RuntimeRequest extends ChatRequest { signal?: AbortSignal; outputSchema?: Record<string, unknown>; }
export interface RuntimeOptions {
  command?: { file: string; args?: string[] };
  configText?: string;
  timeoutMs?: number;
}
const ownProcesses = new Set<ChildProcessWithoutNullStreams>();
const ownControllers = new Set<AbortController>();
const queues = new Map<string, Promise<void>>();
export function closeRuntimes(): void {
  for (const controller of ownControllers) controller.abort();
  for (const process of ownProcesses) process.kill();
}
type Event = { id?: number; method?: string; result?: any; error?: unknown; params?: any };
class Session {
  private buffered = '';
  private events: Event[] = [];
  private waiter?: { resolve: (event: Event) => void; reject: (error: Error) => void };
  private failure?: Error;
  private size = 0;
  private nextId = 0;
  private closed = false;
  readonly pending: Event[] = [];
  readonly child: ChildProcessWithoutNullStreams;
  private abort: () => void;
  constructor(file: string, args: string[], cwd: string, private signal: AbortSignal, private rawJson = false) {
    this.child = spawn(file, args, { cwd, windowsHide: true, env: runtimeEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
    ownProcesses.add(this.child);
    this.abort = () => this.fail(new RuntimeError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled'));
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
    this.child.on('error', () => this.fail(new RuntimeError('not_installed')));
    this.child.on('close', () => {
      this.closed = true;
      if (rawJson && this.buffered.trim()) {
        try { this.push(JSON.parse(this.buffered)); this.buffered = ''; } catch { this.fail(new RuntimeError('protocol_error')); }
      }
      if (!this.events.length) this.fail(new RuntimeError('protocol_error'));
    });
    this.child.stdin.on('error', () => this.fail(new RuntimeError('protocol_error')));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.size += Buffer.byteLength(chunk);
      if (this.size > 8 * 1024 * 1024) { this.fail(new RuntimeError('protocol_error')); return; }
      this.buffered += chunk;
      if (this.rawJson) return;
      let index: number;
      while ((index = this.buffered.indexOf('\n')) >= 0) {
        const line = this.buffered.slice(0, index); this.buffered = this.buffered.slice(index + 1);
        if (!line.trim()) continue;
        try { this.push(JSON.parse(line)); } catch { this.fail(new RuntimeError('protocol_error')); }
      }
    });
    // Never expose native stderr; it may contain account/path/request information.
    this.child.stderr.resume();
  }
  private fail(error: Error): void { this.failure ??= error; this.waiter?.reject(this.failure); this.waiter = undefined; this.child.kill(); }
  private push(event: Event): void {
    if (event.method && event.id !== undefined) {
      this.send({ id: event.id, error: { code: -32601, message: 'Tools disabled' } });
      this.fail(new RuntimeError('tools_disabled')); return;
    }
    if (this.waiter) { this.waiter.resolve(event); this.waiter = undefined; } else this.events.push(event);
  }
  send(event: Event): void { this.child.stdin.write(JSON.stringify(event) + '\n'); }
  event(): Promise<Event> {
    if (this.failure) return Promise.reject(this.failure);
    const next = this.events.shift();
    if (next) return Promise.resolve(next);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }
  async request(method: string, params: unknown): Promise<any> {
    const id = ++this.nextId;
    this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    while (true) {
      const event = await this.event();
      if (event.id !== id) { this.pending.push(event); continue; }
      if (event.error) throw safeError(event.error);
      if (!event.result || typeof event.result !== 'object') throw new RuntimeError('protocol_error');
      return event.result;
    }
  }
  async close(): Promise<void> {
    this.signal.removeEventListener('abort', this.abort);
    if (!this.closed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        this.child.once('close', () => { clearTimeout(timer); resolve(); });
        this.child.kill();
      });
    }
    ownProcesses.delete(this.child);
  }
}
async function serial<T>(id: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  queues.set(id, tail);
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new RuntimeError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      previous.then(() => { signal.removeEventListener('abort', abort); resolve(); });
    });
    signal.throwIfAborted();
    return await run();
  } finally { release(); if (queues.get(id) === tail) void tail.then(() => { if (queues.get(id) === tail) queues.delete(id); }); }
}
function parts(req: ChatRequest): { system: string; prompt: string; images: string[] } {
  const system: string[] = [], text: string[] = [], images: string[] = [];
  for (const message of req.messages) {
    const content = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
    for (const part of content) {
      if (part.type === 'image') {
        if (!/^data:image\/(png|jpeg|webp|gif);base64,|^https:\/\//i.test(part.url)) throw new RuntimeError('unsupported_capability');
        images.push(part.url);
      } else if (message.role === 'system') system.push(part.text);
      else text.push(`${message.role}: ${part.text}`);
    }
  }
  return { system: system.join('\n'), prompt: text.join('\n\n'), images };
}
async function codexSession<T>(signal: AbortSignal, options: RuntimeOptions, run: (session: Session, cwd: string) => Promise<T>): Promise<T> {
  const file = options.command?.file ?? findRuntimeCli('codex');
  if (!file) throw new RuntimeError('not_installed');
  const overrides = codexOverrides(options.configText);
  const cwd = await mkdtemp(join(tmpdir(), 'house-finder-runtime-'));
  const args = [...(options.command?.args ?? []), 'app-server', '--listen', 'stdio://'];
  for (const [key, value] of Object.entries(overrides)) args.push('-c', `${key}=${JSON.stringify(value)}`);
  const session = new Session(file, args, cwd, signal);
  try {
    await session.request('initialize', { clientInfo: { name: 'house_finder', version: '1.0.0' } });
    session.send({ method: 'initialized', params: {} });
    const { account } = await session.request('account/read', { refreshToken: false });
    if (!account) throw new RuntimeError('not_authenticated');
    if (account.type !== 'chatgpt') throw new RuntimeError('subscription_required');
    return await run(session, cwd);
  } finally { await session.close(); await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
const ENVELOPE = { type: 'object', properties: { json: { type: 'string' } }, required: ['json'], additionalProperties: false };
export async function runtimeChat(connection: AiConnection, request: RuntimeRequest, options: RuntimeOptions = {}): Promise<ChatReply> {
  const shutdown = new AbortController();
  ownControllers.add(shutdown);
  const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(options.timeoutMs ?? 300_000), ...(request.signal ? [request.signal] : [])]);
  try { return await serial(connection.id, signal, async () => {
    const { system, prompt, images } = parts(request);
    if (images.length && (!connection.vision || connection.kind === 'claude')) throw new RuntimeError('unsupported_capability');
    const wantsJson = Boolean(request.json || request.outputSchema);
    const instructions = `${system}\nUse no tools. Return only the requested answer.${wantsJson ? '\nReturn an object {"json":"..."}; json must contain the requested JSON encoded as a string.' : ''}${request.outputSchema ? `\nThe JSON inside that string must conform to: ${JSON.stringify(request.outputSchema)}` : ''}`;
    let text: string;
    if (connection.kind === 'codex') {
      text = await codexSession(signal, options, async (session, cwd) => {
        const { thread } = await session.request('thread/start', { cwd, ephemeral: true, modelProvider: 'openai',
          approvalPolicy: 'never', sandbox: 'read-only', baseInstructions: instructions,
          developerInstructions: 'No tools, no filesystem access, no commands. Only answer the supplied request.',
          ...(connection.model ? { model: connection.model } : {}) });
        if (!thread?.id) throw new RuntimeError('protocol_error');
        const { turn } = await session.request('turn/start', { threadId: thread.id,
          input: [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image', url }))], summary: 'none',
          ...(connection.reasoning ? { effort: connection.reasoning } : {}), ...(wantsJson ? { outputSchema: ENVELOPE } : {}) });
        if (!turn?.id) throw new RuntimeError('protocol_error');
        let answer = '';
        while (true) {
          const event = session.pending.shift() ?? await session.event();
          const data = event.params ?? {};
          if (data.threadId && data.threadId !== thread.id || data.turnId && data.turnId !== turn.id) continue;
          if (event.method === 'item/started' && !['agentMessage', 'reasoning', 'userMessage', 'plan'].includes(data.item?.type))
            throw new RuntimeError('tools_disabled');
          if (event.method === 'item/completed') {
            const item = data.item ?? {};
            if (item.type === 'agentMessage' && item.phase !== 'commentary') answer = String(item.text ?? '');
            else if (!['agentMessage', 'reasoning', 'userMessage', 'plan'].includes(item.type)) throw new RuntimeError('tools_disabled');
          }
          if (event.method === 'turn/completed') {
            const result = data.turn;
            if (result?.status !== 'completed') throw safeError(result);
            if ((result.items ?? []).some((item: any) => !['agentMessage', 'reasoning', 'userMessage', 'plan'].includes(item.type)))
              throw new RuntimeError('tools_disabled');
            if (!answer) for (const item of result.items ?? []) if (item.type === 'agentMessage' && item.phase !== 'commentary') answer = String(item.text ?? '');
            if (!answer.trim()) throw new RuntimeError('protocol_error');
            return answer.trim();
          }
        }
      });
    } else if (connection.kind === 'claude') {
      const file = options.command?.file ?? findRuntimeCli('claude');
      if (!file) throw new RuntimeError('not_installed');
      const cwd = await mkdtemp(join(tmpdir(), 'house-finder-runtime-'));
      const base = [...(options.command?.args ?? []), '--setting-sources', '', '--safe-mode', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-chrome'];
      const once = async (args: string[], input = '') => {
        const session = new Session(file, args, cwd, signal, true);
        try { session.child.stdin.end(input); return await session.event() as any; } finally { await session.close(); }
      };
      try {
        const auth = await once([...base, 'auth', 'status', '--json']);
        if (!auth.loggedIn) throw new RuntimeError('not_authenticated');
        if (!['claude.ai', 'oauth_token'].includes(auth.authMethod)) throw new RuntimeError('subscription_required');
        const result = await once([...base, '-p', '--output-format', 'json', '--no-session-persistence', '--system-prompt', instructions,
          ...(connection.model ? ['--model', connection.model] : []), ...(wantsJson ? ['--json-schema', JSON.stringify(ENVELOPE)] : [])], prompt);
        if (/max_tokens|max_output_tokens|length/.test(result.stop_reason ?? '') || /error_max_turns|error_max_budget|error_max_structured/.test(result.subtype ?? '')) throw new RuntimeError('truncated');
        if (result.is_error || result.subtype && result.subtype !== 'success') throw safeError(result);
        text = result.structured_output ? JSON.stringify(result.structured_output) : String(result.result ?? '');
      } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    } else throw new RuntimeError('protocol_error');
    if (wantsJson) {
      try { const envelope = JSON.parse(text); if (typeof envelope.json !== 'string') throw new Error(); JSON.parse(envelope.json); text = envelope.json; }
      catch { throw new RuntimeError('protocol_error'); }
    }
    if (!text.trim()) throw new RuntimeError('protocol_error');
    return { text, finishReason: 'stop' };
  }); } finally { ownControllers.delete(shutdown); }
}
export interface RuntimeStatus {
  id: string; kind: AiConnection['kind']; installed: boolean; authenticated: boolean; ready: boolean;
  models: { id: string; label: string; vision: boolean }[];
  code?: string; detail?: string;
}
export async function runtimeStatus(connection: AiConnection, options: RuntimeOptions = {}): Promise<RuntimeStatus> {
  const installed = Boolean(options.command || findRuntimeCli(connection.kind === 'claude' ? 'claude' : 'codex'));
  const base = { id: connection.id, kind: connection.kind, installed, authenticated: false, ready: false, models: [] as { id: string; label: string; vision: boolean }[] };
  if (!installed) return { ...base, code: 'not_installed', detail: MESSAGES.not_installed };
  const signal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  try {
    if (connection.kind === 'claude') {
      // Subscription cannot be inferred from the executable alone. Never initiate login.
      const file = options.command?.file ?? findRuntimeCli('claude')!;
      const cwd = await mkdtemp(join(tmpdir(), 'house-finder-runtime-'));
      const session = new Session(file, [...(options.command?.args ?? []), '--setting-sources', '', '--safe-mode', '--strict-mcp-config', '--tools', '', 'auth', 'status', '--json'], cwd, signal, true);
      try {
        session.child.stdin.end(); const auth = await session.event() as any;
        if (!auth.loggedIn) throw new RuntimeError('not_authenticated');
        if (!['claude.ai', 'oauth_token'].includes(auth.authMethod)) throw new RuntimeError('subscription_required');
        return { ...base, authenticated: true, ready: true, models: connection.model ? [{ id: connection.model, label: connection.model, vision: false }] : [] };
      } finally { await session.close(); await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    }
    return await codexSession(signal, options, async (session) => {
      const result = await session.request('model/list', { limit: 100, includeHidden: false });
      const rows = Array.isArray(result.data) ? result.data : [];
      return { ...base, authenticated: true, ready: true, models: rows.map((m: any) => ({ id: String(m.id ?? m.model), label: String(m.displayName ?? m.id ?? m.model),
        vision: Array.isArray(m.inputModalities) && m.inputModalities.includes('image') })) };
    });
  } catch (e) { const error = e instanceof RuntimeError ? e : new RuntimeError('protocol_error'); return { ...base, code: error.code, detail: error.message }; }
}
