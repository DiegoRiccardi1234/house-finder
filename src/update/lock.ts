import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, futimesSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const UPDATE_LOCK_TTL_MS = 120_000;
export const HEARTBEAT_MS = 5_000;
export interface LockState { pid: number; version: string; age: number; stale: boolean; owner: string | null }
const owners = new Map<string, string>();
const validOwner = (owner: string): boolean => /^[a-zA-Z0-9-]{8,100}$/.test(owner);
export function createLockOwner(): string { return randomUUID(); }
export function lockPath(stateDir: string): string { return join(stateDir, 'update.lock'); }
const ownerPath = (stateDir: string, owner: string): string => join(lockPath(stateDir), `owner-${owner}.json`);
const releasedPath = (stateDir: string, owner: string): string => join(lockPath(stateDir), `released-${owner}`);

interface Snapshot { state: LockState; released: boolean; identity: string; legacy: boolean }
function inspect(stateDir: string): Snapshot | null {
  const root = lockPath(stateDir);
  try {
    const info = statSync(root);
    if (info.isFile()) {
      let parsed: { pid?: number; version?: string } = {};
      try { parsed = JSON.parse(readFileSync(root, 'utf8')); } catch { /* fail closed until stale */ }
      const age = Date.now() - info.mtimeMs;
      return { state: { pid: Number(parsed.pid) || 0, version: String(parsed.version ?? ''), age,
        stale: age > UPDATE_LOCK_TTL_MS, owner: null }, released: false, legacy: true,
      identity: `legacy-${info.ino}-${info.birthtimeMs}` };
    }
    const entry = readdirSync(root).find((name) => /^owner-[a-zA-Z0-9-]{8,100}\.json$/.test(name));
    if (!entry) {
      const age = Date.now() - info.birthtimeMs;
      return { state: { pid: 0, version: '', age, stale: age > UPDATE_LOCK_TTL_MS, owner: null },
        released: false, legacy: false, identity: `empty-${info.ino}-${info.birthtimeMs}` };
    }
    const owner = entry.slice(6, -5);
    const data = JSON.parse(readFileSync(join(root, entry), 'utf8')) as { pid: number; version: string };
    const age = Date.now() - statSync(join(root, entry)).mtimeMs;
    return { state: { pid: data.pid, version: data.version, age, stale: age > UPDATE_LOCK_TTL_MS, owner },
      released: existsSync(releasedPath(stateDir, owner)), legacy: false, identity: owner };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    try {
      const info = statSync(root);
      const age = Date.now() - info.birthtimeMs;
      return { state: { pid: 0, version: '', age, stale: age > UPDATE_LOCK_TTL_MS, owner: null },
        released: false, legacy: info.isFile(), identity: `corrupt-${info.ino}-${info.birthtimeMs}` };
    } catch {
      return { state: { pid: 0, version: '', age: 0, stale: false, owner: null },
        released: false, legacy: false, identity: 'unreadable' };
    }
  }
}
export function readLock(stateDir: string): LockState | null {
  const snapshot = inspect(stateDir);
  return !snapshot || snapshot.released ? null : snapshot.state;
}

/** Exclusive claim serializes stale takeovers; old owners only touch their immutable marker. */
function retire(stateDir: string, before: Snapshot): boolean {
  const root = lockPath(stateDir);
  let legacyClaim: string | undefined;
  if (before.legacy) {
    legacyClaim = `${root}.takeover-${before.identity}`;
    try { mkdirSync(legacyClaim); } catch { return false; }
    const current = inspect(stateDir);
    if (!current?.legacy || current.identity !== before.identity || !current.state.stale) {
      rmSync(legacyClaim, { recursive: true, force: true });
      return false;
    }
  } else {
    const claim = join(root, `takeover-${before.identity}`);
    try { writeFileSync(claim, '', { flag: 'wx' }); } catch { return false; }
    const current = inspect(stateDir);
    if (!current || current.identity !== before.identity || (!current.released && !current.state.stale)) {
      rmSync(claim, { force: true });
      return false;
    }
  }
  const retired = `${root}.retired-${randomUUID()}`;
  try { renameSync(root, retired); } catch {
    if (!before.legacy) rmSync(join(root, `takeover-${before.identity}`), { force: true });
    return false;
  }
  finally { if (legacyClaim) rmSync(legacyClaim, { recursive: true, force: true }); }
  // An antivirus can hold a retired file briefly; it must not invalidate the new acquisition.
  try { rmSync(retired, { recursive: true, force: true }); } catch { /* isolated retired generation */ }
  return true;
}

export function acquireLock(stateDir: string, version: string, pid = process.pid,
  requestedOwner?: string): boolean {
  mkdirSync(dirname(lockPath(stateDir)), { recursive: true });
  const current = inspect(stateDir);
  const owner = requestedOwner ?? (current && !current.released && !current.state.stale && current.state.pid === pid
    ? owners.get(resolve(stateDir)) : undefined) ?? createLockOwner();
  if (!validOwner(owner)) return false;
  if (current && !current.released && !current.state.stale) {
    if (current.state.owner !== owner || current.state.pid !== pid) return false;
    return touchLock(stateDir, version, pid, owner);
  }
  if (current && !retire(stateDir, current)) return false;
  try { mkdirSync(lockPath(stateDir)); } catch { return false; }
  writeFileSync(ownerPath(stateDir, owner), JSON.stringify({ pid, version }), { flag: 'wx' });
  owners.set(resolve(stateDir), owner);
  return true;
}

/** Touch a pre-existing marker by handle; never create or replace another generation. */
export function touchLock(stateDir: string, _version: string, _pid = process.pid,
  owner = owners.get(resolve(stateDir)) ?? ''): boolean {
  if (!validOwner(owner)) return false;
  let fd: number | undefined;
  try {
    if (existsSync(releasedPath(stateDir, owner))) return false;
    fd = openSync(ownerPath(stateDir, owner), 'r+');
    const now = new Date();
    futimesSync(fd, now, now);
    return true;
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** The tombstone is retired by the next acquisition, never by a late owner. */
export function releaseLock(stateDir: string, owner = owners.get(resolve(stateDir)) ?? ''): boolean {
  if (!validOwner(owner) || !existsSync(ownerPath(stateDir, owner))) return false;
  try {
    writeFileSync(releasedPath(stateDir, owner), '', { flag: 'wx' });
    if (owners.get(resolve(stateDir)) === owner) owners.delete(resolve(stateDir));
    return true;
  } catch { return false; }
}
export function clearStaleLock(stateDir: string): boolean {
  const current = inspect(stateDir);
  return !current || current.released || (current.state.stale && retire(stateDir, current));
}
export function startHeartbeat(stateDir: string, version: string, pid = process.pid,
  owner = owners.get(resolve(stateDir)) ?? ''): () => void {
  touchLock(stateDir, version, pid, owner);
  const timer = setInterval(() => touchLock(stateDir, version, pid, owner), HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
