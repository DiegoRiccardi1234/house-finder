import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Meta, StoredListing, ListingFilters, ListingStatus, SseEvent } from './types';

export function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    api.meta().then(setMeta).catch(() => setMeta(null));
  }, []);
  return meta;
}

export function useListings(filters: ListingFilters) {
  const [items, setItems] = useState<StoredListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listings(filters));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
