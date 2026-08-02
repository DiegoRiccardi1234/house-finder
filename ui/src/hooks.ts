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

/** Quanto si aspetta che il server torni su dopo la sostituzione dei file. */
const RIAVVIO_TIMEOUT_MS = 300_000;
const SONDAGGIO_MS = 2_000;

export type UpdatePhase = 'idle' | 'running' | 'error' | 'timeout';

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
    const scadenza = Date.now() + RIAVVIO_TIMEOUT_MS;
    let fermo = false;

    const giro = async (): Promise<void> => {
      if (fermo) return;
      try {
        const p = await api.updateProgress();
        setProgress(p);
        if (p.step === 'error') {
          setPhase('error');
          setMessage(p.detail ?? 'Aggiornamento non riuscito.');
          return;
        }
      } catch {
        // Il server si sta spegnendo o è già giù: è il momento previsto, non un guasto.
      }
      try {
        const meta = await api.meta();
        if (versioneIniziale.current && meta.version !== versioneIniziale.current) {
          window.location.reload();
          return;
        }
      } catch {
        /* server ancora giù */
      }
      if (Date.now() > scadenza) {
        setPhase('timeout');
        setMessage(
          'Il programma non è tornato su entro cinque minuti. Il diario è in ' +
            'state\\logs\\updater.log.',
        );
        return;
      }
      setTimeout(() => void giro(), SONDAGGIO_MS);
    };
    void giro();
    return () => {
      fermo = true;
    };
  }, [phase]);

  const check = useCallback((f = false) => {
    setForce(f);
    setToken((n) => n + 1);
  }, []);

  const start = useCallback(async () => {
    setMessage(null);
    const res = await api.startUpdate();
    if (res.status === 202) {
      setPhase('running');
      setProgress({ step: 'download', pct: 1, detail: 'avvio', ts: Date.now(), busy: true });
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
    setPhase('error');
    setMessage(body.detail ?? body.error ?? `Errore HTTP ${res.status}.`);
  }, []);

  /** Sblocca un aggiornamento rimasto appeso: senza, il pulsante resta morto per due minuti. */
  const unlock = useCallback(async () => {
    await api.clearUpdateLock().catch(() => {});
    setPhase('idle');
    setMessage(null);
    setToken((n) => n + 1);
  }, []);

  return { info, progress, phase, message, check, start, unlock };
}

export function useListings(filters: ListingFilters, refreshToken = 0) {
  const [items, setItems] = useState<StoredListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    try {
      const updated = await api.setStatus(key, status);
      setItems((prev) => prev.map((r) => (r.key === key ? updated : r)));
    } catch (e) {
      setError(`Azione non riuscita: ${(e as Error).message}`); // niente più fallimento silenzioso
    }
  }, []);

  return { items, loading, error, refresh, setStatus };
}

/**
 * Stream SSE della run corrente. EventSource resta aperto per tutta la vita del componente e
 * riceve log/done/error; `start()` fa la POST e gestisce il 409 (run già in corso).
 */
export function useRunStream(onDone: () => void) {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<RunEsito | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const es = new EventSource('/api/runs/stream');
    es.onmessage = (e) => {
      let ev: SseEvent;
      try {
        ev = JSON.parse(e.data) as SseEvent;
      } catch {
        return;
      }
      if (ev.type === 'log') setLines((l) => [...l, ev.line]);
      else if (ev.type === 'done') {
        setRunning(false);
        // Il riepilogo arrivava e finiva nel nulla: l'unica traccia di una ricerca era una riga
        // di log. Chi la lanciava non sapeva quanti annunci fossero arrivati, né dove guardarli.
        const r = ev.summary?.results ?? [];
        setSummary({
          nuovi: r.reduce((n, x) => n + (x.fresh ?? 0), 0),
          visti: r.reduce((n, x) => n + (x.unique ?? 0), 0),
          canali: r.length,
        });
        setLines((l) => [...l, '✅ Ricerca conclusa.']);
        onDoneRef.current();
      } else if (ev.type === 'error') {
        setRunning(false);
        setLines((l) => [...l, `❌ ERRORE: ${ev.message}`]);
        onDoneRef.current();
      }
    };
    // stato iniziale (se una run è già in corso all'apertura)
    fetch('/api/runs/current')
      .then((r) => r.json())
      .then((s: { running: boolean }) => setRunning(!!s.running))
      .catch(() => {});
    return () => es.close();
  }, []);

  const start = useCallback(async (channels: string[]) => {
    setLines([]);
    setSummary(null);
    let r: Response;
    try {
      r = await api.startRun(channels);
    } catch (e) {
      setLines([`❌ Il server non risponde: ${(e as Error).message}. Riavvia l'app e riprova.`]);
      return;
    }
    if (r.status === 202) {
      setRunning(true);
    } else if (r.status === 409) {
      setRunning(true);
      setLines(['⚠️ Una ricerca era già in corso: mi aggancio a quella.']);
    } else {
      // Un codice HTTP non dice niente a chi legge: si dice cosa fare.
      setLines([`❌ La ricerca non è partita. Riprova; se insiste, riavvia l'app.`]);
    }
  }, []);

  return { lines, running, summary, start };
}
