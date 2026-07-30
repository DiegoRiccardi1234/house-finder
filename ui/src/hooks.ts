import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { Meta, StoredListing, ListingFilters, ListingStatus, SseEvent } from './types';

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
        setLines((l) => [...l, '✅ Run conclusa.']);
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
    let r: Response;
    try {
      r = await api.startRun(channels);
    } catch (e) {
      setLines([`❌ Impossibile avviare la run (server raggiungibile?): ${(e as Error).message}`]);
      return;
    }
    if (r.status === 202) {
      setRunning(true);
    } else if (r.status === 409) {
      setRunning(true);
      setLines(['⚠️ Una run è già in corso — mi aggancio al log.']);
    } else {
      setLines([`Errore avvio run (HTTP ${r.status}).`]);
    }
  }, []);

  return { lines, running, start };
}
