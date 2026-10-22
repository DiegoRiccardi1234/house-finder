import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type {
  Meta,
  StoredListing,
  ListingFilters,
  ListingStatus,
  SseEvent,
  UpdateInfo,
  UpdateProgress,
  JobId,
  JobState,
  RunEsito,
  RunSummary,
} from './types';

/** Ritarda un valore: evita una fetch per ogni tasto digitato nella ricerca. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMeta(reloadToken = 0): { meta: Meta | null; error: string | null } {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .meta()
      .then((m) => {
        if (!alive) return;
        setMeta(m);
        setError(null);
      })
      .catch((e: Error) => {
        // Prima l'errore veniva inghiottito: server spento e UI muta erano indistinguibili.
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);
  return { meta, error };
}

/**
 * Un lavoro lungo avviato da un pulsante: accesso a Facebook, installazione dei browser.
 *
 * Si interroga il server invece di tenere lo stato nella pagina, così un ricaricamento a metà —
 * o una seconda scheda aperta — vede la stessa cosa. Lo stato iniziale si legge sempre: se il
 * lavoro era già partito prima che la pagina si aprisse, il pulsante deve mostrarsi occupato.
 */
export function useJob(id: JobId): {
  state: JobState | null;
  busy: boolean;
  start: (call: () => Promise<Response>) => Promise<void>;
} {
  const [state, setState] = useState<JobState | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const giro = async (): Promise<void> => {
      try {
        const s = await api.job(id);
        if (!vivo) return;
        setState(s);
        if (s.running) timer = setTimeout(() => void giro(), 1500);
      } catch {
        /* server irraggiungibile: si riprova al prossimo avvio */
      }
    };
    void giro();
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, tick]);

  const start = useCallback(
    async (call: () => Promise<Response>) => {
      const res = await call();
      if (res.status !== 202) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
        setState({
          running: false,
          startedAt: null,
          finishedAt: new Date().toISOString(),
          lines: [],
          outcome: 'error',
          message: body.detail ?? body.error ?? `Errore HTTP ${res.status}.`,
        });
        return;
      }
      setTick((n) => n + 1);
    },
    [],
  );

  return { state, busy: state?.running === true, start };
}

const SONDAGGIO_MS = 2_000;

export type UpdatePhase = 'idle' | 'running' | 'error';

/**
 * Il controllo aggiornamenti e il pulsante che lo applica.
 *
 * Il pezzo delicato è **come si capisce che l'aggiornamento è finito**. Aspettare che "qualcuno
 * risponda" non basta: il server vecchio resta in piedi ancora un istante dopo aver risposto, e su
 * una macchina veloce lo scambio avviene fra due sondaggi — in Job Finder, chi ha la macchina
 * veloce aspetta i cinque minuti pieni e poi legge "non riuscito" di un aggiornamento riuscito.
 * Qui si confronta la **versione** riportata da `/api/meta`, che per questo esiste.
 */
export function useUpdate(): {
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
  phase: UpdatePhase;
  message: string | null;
  check: (force?: boolean) => void;
  start: () => Promise<void>;
  unlock: () => Promise<void>;
} {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const [force, setForce] = useState(false);
  const versioneIniziale = useRef<string | null>(null);
  const attemptStartedAt = useRef<number | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .checkUpdate(force)
      .then((i) => {
        if (!vivo) return;
        setInfo(i);
        versioneIniziale.current ??= i.current;
      })
      .catch(() => {
        /* il controllo aggiornamenti non deve mai rompere la pagina */
      });
    return () => {
      vivo = false;
    };
  }, [token, force]);

  // Un aggiornamento può essere partito da un'altra scheda: lo stato vero sta sul server.
  useEffect(() => {
    api
      .updateProgress()
      .then((p) => {
        setProgress(p);
        if (p.busy) setPhase('running');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (phase !== 'running') return;
    let fermo = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const giro = async (): Promise<void> => {
      if (fermo) return;
      try {
        const p = await api.updateProgress();
        if (fermo) return;
        setProgress(p);
        const currentAttempt = attemptStartedAt.current === null || (p.ts !== null && p.ts >= attemptStartedAt.current);
        if (currentAttempt && p.step === 'error') {
          setPhase('error');
          setMessage(p.detail ?? 'Aggiornamento non riuscito.');
          return;
        }
        if (!p.busy && p.lockStale && p.step !== 'done') {
          setPhase('error');
          setMessage('L’aggiornamento si è interrotto. Puoi riprovare quando il blocco non è più attivo.');
          return;
        }
        if (currentAttempt && p.step === 'done') {
          window.location.reload();
          return;
        }
      } catch {
        // Il server si sta spegnendo o è già giù: è il momento previsto, non un guasto.
      }
      try {
        const meta = await api.meta();
        if (fermo) return;
        if (versioneIniziale.current && meta.version !== versioneIniziale.current) {
          window.location.reload();
          return;
        }
      } catch {
        /* server ancora giù */
      }
      // Una connessione lenta non rende morto il lavoro: è il heartbeat server a decidere.
      if (!fermo) timer = setTimeout(() => void giro(), SONDAGGIO_MS);
    };
    void giro();
    return () => {
      fermo = true;
      clearTimeout(timer);
    };
  }, [phase]);

  const check = useCallback((f = false) => {
    setForce(f);
    setToken((n) => n + 1);
  }, []);

  const start = useCallback(async () => {
    setMessage(null);
    attemptStartedAt.current = Date.now();
    let res: Response;
    try { res = await api.startUpdate(); }
    catch (e) { setPhase('error'); setMessage((e as Error).message); return; }
    if (res.status === 202) {
      setPhase('running');
      setProgress({ step: 'download', pct: 1, detail: 'avvio', ts: Date.now(), busy: true, lockStale: false });
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
    setPhase('error');
    setMessage(body.detail ?? body.error ?? `Errore HTTP ${res.status}.`);
  }, []);

  /** Sblocca un aggiornamento rimasto appeso: senza, il pulsante resta morto per due minuti. */
  const unlock = useCallback(async () => {
    try {
      if (progress?.lockStale) await api.clearUpdateLock();
      setPhase('idle');
      setMessage(null);
      setToken((n) => n + 1);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [progress?.lockStale]);

  return { info, progress, phase, message, check, start, unlock };
}

export function useListings(filters: ListingFilters, refreshToken = 0, onChanged?: () => void) {
  const [items, setItems] = useState<StoredListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manual, setManual] = useState(0);
  const abort = useRef<AbortController | null>(null);

  // Solo il testo libero va ritardato: i select cambiano di rado e devono rispondere subito.
  const q = useDebounced(filters.q, 250);
  const effective = useMemo<ListingFilters>(() => ({ ...filters, q }), [
    filters.channel,
    filters.status,
    filters.city,
    filters.minScore,
    filters.sort,
    filters.arredato,
    filters.soloPrivati,
    q,
  ]);

  useEffect(() => {
    abort.current?.abort(); // la risposta lenta di una query vecchia non deve sovrascrivere la nuova
    const ac = new AbortController();
    abort.current = ac;
    setLoading(true);
    setError(null);
    api
      .listings(effective, ac.signal)
      .then((rows) => {
        if (!ac.signal.aborted) setItems(rows);
      })
      .catch((e: Error) => {
        if (ac.signal.aborted || e.name === 'AbortError') return;
        setError(e.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [effective, refreshToken, manual]);

  const refresh = useCallback(() => setManual((n) => n + 1), []);

  const setStatus = useCallback(async (key: string, status: ListingStatus) => {
    setActionError(null);
    try {
      const updated = await api.setStatus(key, status);
      setItems((prev) => prev.map((r) => (r.key === key ? updated : r)));
      onChanged?.();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, [onChanged]);

  return { items, loading, error, actionError, refresh, setStatus };
}

/**
 * Stream SSE della run corrente. EventSource resta aperto per tutta la vita del componente e
 * riceve log/done/error; `start()` fa la POST e gestisce il 409 (run già in corso).
 */
export function useRunStream(onDone: () => void) {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<RunEsito | null>(null);
  const [synchronized, setSynchronized] = useState(false);
  const [starting, setStarting] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const es = new EventSource('/api/runs/stream');
    let runId: string | null = null;
    let completedId: string | null = null;
    let awaitingSnapshot = true;
    const showSummary = (value: RunSummary) => {
      const r = value.results ?? [];
      const errors = [...new Set(r.flatMap((x) => x.errors.map((message) => `${x.channel}: ${message}`)))];
      const outcome = value.outcome ?? (errors.length ? 'partial' : 'succeeded');
      setSummary({ nuovi: r.reduce((n, x) => n + (x.fresh ?? 0), 0),
        visti: r.reduce((n, x) => n + (x.unique ?? 0), 0), canali: r.length, outcome, errors });
      if (completedId !== value.runId) {
        completedId = value.runId;
        onDoneRef.current();
      }
    };
    // Il server ripete il buffer alla riconnessione: sostituisce il log, non lo duplica.
    es.onopen = () => { awaitingSnapshot = true; setLines([]); };
    es.onerror = () => setSynchronized(false);
    es.onmessage = (e) => {
      let ev: SseEvent;
      try {
        ev = JSON.parse(e.data) as SseEvent;
      } catch {
        return;
      }
      if (ev.type === 'state') {
        setSynchronized(true);
        setRunning(ev.status.running);
        if (ev.status.running) {
          if (!awaitingSnapshot && runId !== ev.status.runId) setLines([]);
          runId = ev.status.runId;
          setSummary(null);
        } else if (ev.status.summary) showSummary(ev.status.summary);
        else setSummary(null);
        awaitingSnapshot = false;
      } else if (ev.type === 'log') setLines((l) => [...l.slice(-499), ev.line]);
      else if (ev.type === 'done') {
        setRunning(false);
        // Il riepilogo arrivava e finiva nel nulla: l'unica traccia di una ricerca era una riga
        // di log. Chi la lanciava non sapeva quanti annunci fossero arrivati, né dove guardarli.
        showSummary(ev.summary);
        const outcome = ev.summary.outcome ?? 'succeeded';
        setLines((l) => [...l, outcome === 'succeeded' ? '✅ Ricerca conclusa.' : outcome === 'partial' ? '⚠️ Ricerca conclusa con problemi.' : '❌ Ricerca non riuscita.']);
      } else if (ev.type === 'error') {
        setRunning(false);
        setLines((l) => [...l, `❌ ERRORE: ${ev.message}`]);
        onDoneRef.current();
      }
    };
    // Lo snapshot SSE arriva dopo il replay: niente GET concorrente che possa riattivare una run conclusa.
    return () => es.close();
  }, []);

  const start = useCallback(async (channels: string[]) => {
    setLines([]);
    setSummary(null);
    let r: Response;
    setStarting(true);
    try {
      r = await api.startRun(channels);
    } catch (e) {
      setLines([`❌ Il server non risponde: ${(e as Error).message}. Riavvia l'app e riprova.`]);
      return;
    } finally {
      setStarting(false);
    }
    if (r.status !== 202) {
      // Un codice HTTP non dice niente a chi legge: si dice cosa fare.
      const body = await r.json().catch(() => ({})) as { error?: string; runId?: string };
      setLines([r.status === 409 && body.runId
        ? '⚠️ Una ricerca era già in corso: mi aggancio a quella.'
        : `❌ ${body.error ?? 'La ricerca non è partita. Riprova; se insiste, riavvia l’app.'}`]);
    }
  }, []);

  return { lines, running: running || starting, summary, start, synchronized };
}
