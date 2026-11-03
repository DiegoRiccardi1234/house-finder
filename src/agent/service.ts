import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ListingStore, StoredListing } from '../core/store.js';
import { writeJsonAtomic } from '../core/atomic.js';
import type { ChannelId } from '../core/pipeline.js';
import { loadProfile, saveProfile, type Profile } from '../config/profile.js';
import { buildStats } from '../server/stats.js';
import { SearchesSchema, StatusSchema } from '../server/schemas.js';
import { APP_VERSION } from '../version.js';

export class AgentError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export const ProfileProposalSchema = z.object({
  searches: SearchesSchema.max(100),
  zones: z.array(z.object({ city: z.string().min(1).max(100), keep: z.array(z.string().max(200)).max(100), avoid: z.array(z.string().max(200)).max(100) }).strict()).max(100),
  musts: z.array(z.string().min(1).max(500)).max(100),
  notes: z.string().max(30_000),
}).strict();
export const ScanProposalSchema = z.object({
  channels: z.array(z.enum(['email', 'subito', 'immobiliare', 'idealista', 'facebook'])).min(1).max(5)
    .refine((items) => new Set(items).size === items.length),
}).strict();
const RequestId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/);
const Key = z.string().min(1).max(500);
const Empty = z.object({}).strict();
export const ToolSchemas = {
  housefinder_health: Empty,
  housefinder_list_listings: z.object({ query: z.string().max(500).optional(), city: z.string().max(100).optional(), status: StatusSchema.optional(), channel: z.string().max(50).optional(), minScore: z.number().min(0).max(100).optional(), offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(30) }).strict(),
  housefinder_get_listing: z.object({ key: Key }).strict(),
  housefinder_get_stats: Empty,
  housefinder_get_profile: Empty,
  housefinder_get_run: Empty,
  housefinder_set_status: z.object({ key: Key, status: StatusSchema, requestId: RequestId }).strict(),
  housefinder_propose_profile: z.object({ profile: ProfileProposalSchema, requestId: RequestId }).strict(),
  housefinder_propose_scan: ScanProposalSchema.extend({ requestId: RequestId }),
  housefinder_get_operation: z.object({ operationId: z.string().min(1).max(100) }).strict(),
} as const;
export type AgentToolName = keyof typeof ToolSchemas;
export interface AgentDeps {
  store: ListingStore;
  stateDir: string;
  /** Must include run, archive mutation and live updater ownership. */
  isBusy: () => boolean;
  getRunStatus: () => unknown;
  /** Must use score:false and vision:false, plus the normal scan preconditions. */
  startScan: (channels: ChannelId[]) => string | Promise<string>;
  getProfile?: () => Profile;
  saveProfile?: (profile: Profile) => Promise<void>;
}
export interface AgentOperation {
  id: string;
  kind: 'status' | 'profile' | 'scan';
  state: 'pending' | 'applying' | 'completed' | 'confirmed' | 'rejected' | 'interrupted' | 'failed';
  requestId: string;
  fingerprint: string;
  profileFingerprint?: string;
  createdAt: string;
  updatedAt: string;
  payload: unknown;
  result?: unknown;
  error?: string;
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);

function safeRecord(row: StoredListing, detail: boolean): Record<string, unknown> {
  return {
    key: row.key, listing: { source: row.listing.source, id: row.listing.id, url: row.listing.url,
      title: row.listing.title, price: row.listing.price, zone: row.listing.zone,
      rooms: row.listing.rooms, sizeSqm: row.listing.sizeSqm,
      desc: (row.listing.desc ?? '').slice(0, detail ? 30_000 : 600) },
    ai: row.ai, fields: row.fields, channel: row.channel, firstSeen: row.firstSeen,
    lastSeen: row.lastSeen, status: row.status,
  };
}

/** Domain operations in the existing application's process; never opens another store. */
export class AgentService {
  readonly tokenFile: string;
  readonly journalFile: string;
  private tokenChain: Promise<unknown> = Promise.resolve();
  private chain: Promise<unknown> = Promise.resolve();
  private applying = false;
  private getProfile: () => Profile;
  private saveProfile: (profile: Profile) => Promise<void>;

  constructor(private deps: AgentDeps) {
    this.tokenFile = resolve(deps.stateDir, 'agent', 'mcp-token.txt');
    this.journalFile = resolve(deps.stateDir, 'agent', 'operations.json');
    this.getProfile = deps.getProfile ?? loadProfile;
    this.saveProfile = deps.saveProfile ?? saveProfile;
  }

  get isApplying(): boolean { return this.applying; }

  private assertPrivatePath(path: string): void {
    // Refuse redirected token/journal files and directory junctions.
    for (const part of [resolve(this.deps.stateDir), dirname(path), path]) {
      if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new AgentError('unsafe_agent_path', 503);
    }
  }

  async setup(url: string): Promise<Record<string, unknown>> {
    const work = this.tokenChain.then(async () => {
      this.assertPrivatePath(this.tokenFile);
      await mkdir(dirname(this.tokenFile), { recursive: true });
      try { await writeFile(this.tokenFile, randomBytes(48).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (!this.readToken()) throw new AgentError('invalid_agent_token', 503);
      const built = fileURLToPath(new URL('../../scripts/mcp.js', import.meta.url));
      const script = existsSync(built) ? built : fileURLToPath(new URL('../../scripts/mcp.ts', import.meta.url));
      const args = [...(script.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []), script, '--url', url, '--token-file', this.tokenFile];
      const command = process.execPath;
      return { url, endpoint: `${url}/mcp`, tokenFile: this.tokenFile, command, args,
        codexConfig: `[mcp_servers.housefinder]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`,
        clientConfig: { mcpServers: { housefinder: { command, args } } } };
    });
    this.tokenChain = work.catch(() => {});
    return work;
  }

  private readToken(): string | null {
    this.assertPrivatePath(this.tokenFile);
    try {
      const token = readFileSync(this.tokenFile, 'utf8').trim();
      return /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AgentError('invalid_agent_token', 503);
    }
  }

  authenticated(supplied: string): boolean {
    const token = this.readToken();
    if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(supplied) || supplied.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.chain.then(fn);
    this.chain = work.catch(() => {});
    return work;
  }

  private async readJournal(): Promise<AgentOperation[]> {
    this.assertPrivatePath(this.journalFile);
    let text: string;
    try { text = await readFile(this.journalFile, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new AgentError('agent_journal_unavailable', 503); }
    try {
      const parsed = JSON.parse(text) as { version: number; operations: AgentOperation[] };
      if (parsed.version !== 1 || !Array.isArray(parsed.operations) || parsed.operations.some((r) => !r || typeof r.id !== 'string' || typeof r.requestId !== 'string')) throw new Error();
      let changed = false;
      for (const row of parsed.operations) {
        if (row.state === 'applying') {
          row.state = 'interrupted'; row.error = 'operation_uncertain_check_state'; changed = true;
        }
      }
      if (changed) await this.persist(parsed.operations);
      return parsed.operations;
    } catch { throw new AgentError('agent_journal_invalid', 503); }
  }

  private async persist(rows: AgentOperation[]): Promise<void> {
    this.assertPrivatePath(this.journalFile);
    await writeJsonAtomic(this.journalFile, { version: 1, operations: rows });
  }

  private assertIdle(): void { if (this.deps.isBusy()) throw new AgentError('archive_busy', 409); }

  private async createOperation(kind: AgentOperation['kind'], requestId: string, payload: unknown, effect?: () => Promise<unknown>): Promise<AgentOperation> {
    return this.serialized(async () => {
      const rows = await this.readJournal();
      const fingerprint = hash({ kind, payload });
      const existing = rows.find((r) => r.requestId === requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new AgentError('request_id_conflict', 409);
        if (existing.state === 'applying') throw new AgentError('operation_uncertain_check_state', 409);
        return clone(existing);
      }
      this.assertIdle();
      if (rows.length >= 20_000) throw new AgentError('agent_history_full', 503);
      const now = new Date().toISOString();
      const row: AgentOperation = { id: randomBytes(16).toString('hex'), kind, state: effect ? 'applying' : 'pending', requestId,
        fingerprint, ...(kind === 'status' ? {} : { profileFingerprint: hash(this.getProfile()) }), createdAt: now, updatedAt: now, payload: clone(payload) };
      rows.push(row);
      await this.persist(rows);
      if (effect) {
        try { row.result = await effect(); row.state = 'completed'; }
        catch (error) { row.state = 'failed'; row.error = error instanceof AgentError ? error.code : 'operation_failed_check_state'; }
        row.updatedAt = new Date().toISOString();
        await this.persist(rows);
        if (row.state === 'failed') throw new AgentError(row.error!, 409);
      }
      return clone(row);
    });
  }

  async proposals(): Promise<AgentOperation[]> {
    return this.serialized(async () => clone((await this.readJournal()).filter((r) => r.kind !== 'status' && ['pending', 'applying', 'failed'].includes(r.state))));
  }

  /** Not exported through MCP. Browser credentials are checked by agentRoutes. */
  async decide(id: string, accept: boolean): Promise<AgentOperation> {
    return this.serialized(async () => {
      const rows = await this.readJournal();
      const row = rows.find((r) => r.id === id && r.kind !== 'status');
      if (!row) throw new AgentError('proposal_not_found', 404);
      const desired = accept ? 'confirmed' : 'rejected';
      if (row.state === desired) return clone(row);
      if (row.state !== 'pending') throw new AgentError('proposal_not_pending', 409);
      if (!accept) { row.state = 'rejected'; row.updatedAt = new Date().toISOString(); await this.persist(rows); return clone(row); }
      this.assertIdle();
      if (row.profileFingerprint !== hash(this.getProfile())) throw new AgentError('profile_changed_propose_again', 409);
      row.state = 'applying'; row.updatedAt = new Date().toISOString(); await this.persist(rows);
      this.applying = row.kind === 'profile';
      try {
        this.assertIdle();
        if (row.kind === 'profile') { await this.saveProfile(ProfileProposalSchema.parse(row.payload)); row.result = { saved: true }; }
        else { const scan = ScanProposalSchema.parse(row.payload); row.result = { runId: await this.deps.startScan(scan.channels) }; }
        row.state = 'confirmed';
      } catch (error) {
        row.state = 'failed'; row.error = error instanceof AgentError ? error.code : 'proposal_failed_check_state';
      } finally { this.applying = false; }
      row.updatedAt = new Date().toISOString(); await this.persist(rows);
      if (row.state === 'failed') throw new AgentError(row.error!, 409);
      return clone(row);
    });
  }

  async dispatch(name: string, args: unknown): Promise<unknown> {
    if (!Object.hasOwn(ToolSchemas, name)) throw new AgentError('unknown_tool', 404);
    const schema = ToolSchemas[name as AgentToolName];
    const parsed = schema.safeParse(args);
    if (!parsed.success) throw new AgentError('invalid_tool_arguments');
    switch (name as AgentToolName) {
      case 'housefinder_health': return { app: 'House Finder', version: APP_VERSION, ready: true, busy: this.deps.isBusy(), toolsUseAi: false };
      case 'housefinder_list_listings': {
        const q = ToolSchemas.housefinder_list_listings.parse(args);
        const rows = this.deps.store.all().filter((r) => {
          const text = `${r.listing.title} ${r.listing.zone ?? ''} ${r.listing.desc ?? ''}`.toLowerCase();
          return (!q.query || text.includes(q.query.toLowerCase())) && (!q.city || text.includes(q.city.toLowerCase()))
            && (!q.status || r.status === q.status) && (!q.channel || (q.channel === 'facebook' ? ['facebook', 'fb-group', 'fb-marketplace'].includes(r.channel) : r.channel === q.channel))
            && (q.minScore === undefined || (r.ai !== null && r.ai.score >= q.minScore));
        }).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.key.localeCompare(b.key));
        return { total: rows.length, offset: q.offset, limit: q.limit, listings: rows.slice(q.offset, q.offset + q.limit).map((r) => safeRecord(r, false)) };
      }
      case 'housefinder_get_listing': {
        const { key } = ToolSchemas.housefinder_get_listing.parse(args); const row = this.deps.store.get(key);
        if (!row) throw new AgentError('listing_not_found', 404); return safeRecord(row, true);
      }
      case 'housefinder_get_stats': return buildStats(this.deps.store.all());
      case 'housefinder_get_profile': return clone(this.getProfile());
      case 'housefinder_get_run': {
        const status = this.deps.getRunStatus() as Record<string, unknown>;
        return { running: status.running, runId: status.runId, channels: status.channels, startedAt: status.startedAt,
          summary: status.summary && typeof status.summary === 'object' ? {
            outcome: (status.summary as Record<string, unknown>).outcome,
            finishedAt: (status.summary as Record<string, unknown>).finishedAt,
          } : null };
      }
      case 'housefinder_set_status': {
        const { key, status, requestId } = ToolSchemas.housefinder_set_status.parse(args);
        return this.createOperation('status', requestId, { key, status }, () => {
          this.assertIdle();
          return this.deps.store.mutateAndSave(() => {
            const row = this.deps.store.get(key); if (!row) throw new AgentError('listing_not_found', 404);
            const previousStatus = row.status; this.deps.store.setStatus(key, status);
            return { key, status, previousStatus };
          });
        });
      }
      case 'housefinder_propose_profile': {
        const { profile, requestId } = ToolSchemas.housefinder_propose_profile.parse(args);
        return this.createOperation('profile', requestId, profile);
      }
      case 'housefinder_propose_scan': {
        const { channels, requestId } = ToolSchemas.housefinder_propose_scan.parse(args);
        return this.createOperation('scan', requestId, { channels });
      }
      case 'housefinder_get_operation': {
        const { operationId } = ToolSchemas.housefinder_get_operation.parse(args);
        return this.serialized(async () => { const row = (await this.readJournal()).find((r) => r.id === operationId); if (!row) throw new AgentError('operation_not_found', 404); return clone(row); });
      }
    }
  }
}
