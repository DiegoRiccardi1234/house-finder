import type { LogFn, RunSummary, ChannelId } from '../core/pipeline.js';

/** Eventi streammati in SSE durante una run. */
export type SseEvent =
  | { type: 'log'; line: string }
  | { type: 'done'; summary: RunSummary }
  | { type: 'error'; message: string };

export class RunBusyError extends Error {
  constructor(public runId: string) {
    super(`run già in corso: ${runId}`);
    this.name = 'RunBusyError';
  }
}

export interface RunStatus {
  running: boolean;
  runId: string | null;
  channels: ChannelId[];
  startedAt: string | null;
  summary: RunSummary | null; // ultima run conclusa (quando non in corso)
}

/**
 * Guardia di concorrenza (una run alla volta) + bus SSE con buffer.
 * Chi si connette a run in corso riceve il replay del log già emesso, poi gli eventi live.
 */
export class RunManager {
  private running = false;
  private runId: string | null = null;
  private channels: ChannelId[] = [];
  private startedAt: string | null = null;
  private buffer: SseEvent[] = [];
  private lastSummary: RunSummary | null = null;
  private subscribers = new Set<(e: SseEvent) => void>();

  get isRunning(): boolean {
    return this.running;
  }

  status(): RunStatus {
    return {
      running: this.running,
      runId: this.runId,
      channels: this.channels,
      startedAt: this.startedAt,
      summary: this.running ? null : this.lastSummary,
    };
  }

  /** Iscrive un consumer SSE. Replaya il buffer corrente, poi riceve gli eventi live. Ritorna l'unsubscribe. */
  subscribe(fn: (e: SseEvent) => void): () => void {
    for (const e of this.buffer) fn(e);
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private static readonly MAX_BUFFER = 500;

  private broadcast(e: SseEvent): void {
    this.buffer.push(e);
    if (this.buffer.length > RunManager.MAX_BUFFER) this.buffer.shift(); // niente crescita illimitata
    for (const fn of this.subscribers) fn(e);
  }

  /**
   * Avvia una run. `exec` riceve il log sink (che streamma in SSE) e ritorna il `RunSummary`.
   * Lancia `RunBusyError` se una run è già in corso. Non attende il completamento (fire-and-forget):
   * il chiamante risponde 202 col runId e osserva l'esito via SSE.
   */
  start(channels: ChannelId[], exec: (log: LogFn) => Promise<RunSummary>): string {
    if (this.running) throw new RunBusyError(this.runId ?? 'unknown');
    const runId = `run_${Date.now().toString(36)}`;
    this.running = true;
    this.runId = runId;
    this.channels = channels;
    this.startedAt = new Date().toISOString();
    this.buffer = [];

    const log: LogFn = (line) => this.broadcast({ type: 'log', line });
    exec(log)
      .then((summary) => {
        this.lastSummary = summary;
        this.broadcast({ type: 'done', summary });
      })
      .catch((e: unknown) => {
        this.broadcast({ type: 'error', message: (e as Error).message });
      })
      .finally(() => {
        this.running = false;
        this.runId = null;
        this.channels = [];
        this.startedAt = null;
      });

    return runId;
  }
}
