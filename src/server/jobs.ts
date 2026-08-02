/**
 * Lavori lunghi avviati da un pulsante: accesso a Facebook, installazione dei browser.
 *
 * Sono operazioni che durano da qualche secondo a diversi minuti e che prima esistevano solo come
 * comandi da terminale. La UI le avvia e poi chiede "a che punto siamo": niente SSE, un endpoint
 * di stato basta e si comporta bene anche se la pagina viene ricaricata a metà.
 *
 * Diverso da `RunManager`, che è cucito sulla pipeline (canali, `RunSummary`) e su un solo lavoro
 * per volta. Qui i lavori sono indipendenti fra loro: installare i browser mentre si aspetta il
 * login a Facebook è legittimo.
 */

export type JobId = 'fb-login' | 'install-browsers';

export interface JobState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Le ultime righe di log, per far vedere che qualcosa sta succedendo. */
  lines: string[];
  outcome: 'ok' | 'error' | null;
  message: string | null;
}

const MAX_LINES = 80;

const empty = (): JobState => ({
  running: false,
  startedAt: null,
  finishedAt: null,
  lines: [],
  outcome: null,
  message: null,
});

export class JobBusyError extends Error {
  constructor(id: JobId) {
    super(`lavoro già in corso: ${id}`);
    this.name = 'JobBusyError';
  }
}

export class JobManager {
  private jobs = new Map<JobId, JobState>();

  state(id: JobId): JobState {
    return this.jobs.get(id) ?? empty();
  }

  isRunning(id: JobId): boolean {
    return this.state(id).running;
  }

  /**
   * Avvia il lavoro e torna subito: chi chiama risponde `202` e la UI segue da `GET /api/jobs/:id`.
   * `exec` riceve un log a cui scrivere le righe che l'utente deve vedere.
   */
  start(id: JobId, exec: (log: (line: string) => void) => Promise<string | void>): void {
    if (this.isRunning(id)) throw new JobBusyError(id);

    const st: JobState = { ...empty(), running: true, startedAt: new Date().toISOString() };
    this.jobs.set(id, st);

    const log = (line: string): void => {
      st.lines.push(line);
      if (st.lines.length > MAX_LINES) st.lines.shift();
    };

    exec(log)
      .then((msg) => {
        st.outcome = 'ok';
        st.message = typeof msg === 'string' ? msg : 'Fatto.';
      })
      .catch((e: unknown) => {
        st.outcome = 'error';
        st.message = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        st.running = false;
        st.finishedAt = new Date().toISOString();
      });
  }
}
