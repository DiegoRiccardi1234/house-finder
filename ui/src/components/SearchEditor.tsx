import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { CityZones, Profile, SearchRow } from '../types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Field, Input } from '../ui/Field';
import { Kicker } from '../ui/Kicker';
import { ChipList } from './ChipList';

/**
 * "La tua ricerca": la schermata che sostituisce due editor di testo grezzo.
 *
 * Prima, per dire all'app che cercavi un bilocale a Torino sotto i 750 euro, dovevi scrivere un
 * array JSON con `minRooms` e `maxRooms` in una casella di testo, e ripetere la stessa cosa a
 * parole in un markdown separato — tenendoli allineati a mano. Il tasto "Modifica" del profilo
 * atterrava lì sopra, ed è il motivo per cui sembrava rotto: funzionava, ma non portava da
 * nessuna parte utile.
 *
 * Il testo per l'AI adesso lo genera il server (`src/config/profile.ts`). Resta visibile in fondo,
 * in sola lettura: era l'unica cosa buona dell'editor di prima, e chi vuole controllare cosa
 * legge davvero il modello deve poterlo fare.
 */

const MUST_NOTI = ['Arredato', 'Prezzo entro il tetto', 'Ascensore', 'Balcone', 'Animali ammessi'];

/** Unisce due liste di etichette senza doppioni, tenendo la forma già salvata dall'utente. */
function unisciSenzaDoppioni(base: string[], salvate: string[]): string[] {
  const out = [...salvate];
  for (const b of base) {
    if (!out.some((x) => x.toLowerCase() === b.toLowerCase())) out.push(b);
  }
  return out;
}

export function SearchEditor({ onSaved }: { onSaved?: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [generato, setGenerato] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errore, setErrore] = useState('');

  const carica = useCallback(() => {
    api
      .getProfile()
      .then((s) => {
        setP(s.profile);
        setGenerato(s.generated);
      })
      .catch((e: Error) => setErrore(e.message));
  }, []);

  useEffect(carica, [carica]);

  const citta = useMemo(
    () => Array.from(new Set((p?.searches ?? []).map((s) => s.city))).filter(Boolean),
    [p?.searches],
  );

  if (errore) {
    return (
      <Alert tone="danger" title="Non riesco a leggere la tua ricerca">
        {errore}. Controlla che il server sia acceso.
      </Alert>
    );
  }
  if (!p) return <p className="text-sm text-muted">Carico…</p>;

  const set = (patch: Partial<Profile>): void => setP({ ...p, ...patch });

  const setRiga = (i: number, patch: Partial<SearchRow>): void =>
    set({ searches: p.searches.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const zonaDi = (city: string): CityZones =>
    p.zones.find((z) => z.city === city) ?? { city, keep: [], avoid: [] };

  const setZona = (city: string, patch: Partial<CityZones>): void => {
    const altre = p.zones.filter((z) => z.city !== city);
    set({ zones: [...altre, { ...zonaDi(city), ...patch }] });
  };

  async function salva(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.putProfile(p as Profile);
      setP(s.profile);
      setGenerato(s.generated);
      setMsg('Salvato.');
      onSaved?.();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const nessunaRicerca = p.searches.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {nessunaRicerca && (
        <Alert tone="info" title="Non hai ancora detto cosa cerchi">
          Aggiungi almeno una ricerca qui sotto: una città, che tipo di casa e quanto vuoi spendere
          al massimo. Senza, la scansione non saprebbe dove guardare.
        </Alert>
      )}

      <Card>
        <CardHeader
          kicker="cosa cerchi"
          title="Città, tipo di casa e budget"
          action={
            <Button
              size="sm"
              onClick={() =>
                set({
                  searches: [
                    ...p.searches,
                    {
                      id: '',
                      city: citta[0] ?? '',
                      label: '',
                      maxPrice: 700,
                      minRooms: 2,
                      maxRooms: 2,
                    },
                  ],
                })
              }
            >
              Aggiungi
            </Button>
          }
        />
        <div className="flex flex-col gap-3 p-4">
          {p.searches.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-2 items-end gap-3 border-b border-hair pb-3 last:border-0 last:pb-0 md:grid-cols-[1fr_1.8fr_auto_auto_auto_auto]"
            >
              <Field label="Città">
                {(a) => (
                  <Input
                    {...a}
                    value={r.city}
                    placeholder="torino"
                    onChange={(e) => setRiga(i, { city: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Come la chiami">
                {(a) => (
                  <Input
                    {...a}
                    value={r.label}
                    placeholder="Torino · bilocale"
                    onChange={(e) => setRiga(i, { label: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Max €/mese">
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    min={1}
                    value={r.maxPrice}
                    onChange={(e) => setRiga(i, { maxPrice: Number(e.target.value) })}
                    className="w-28"
                  />
                )}
              </Field>
              <Field label="Locali min">
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    min={1}
                    value={r.minRooms ?? ''}
                    onChange={(e) =>
                      setRiga(i, { minRooms: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="w-20"
                  />
                )}
              </Field>
              <Field label="Locali max">
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    min={1}
                    value={r.maxRooms ?? ''}
                    onChange={(e) =>
                      setRiga(i, { maxRooms: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="w-20"
                  />
                )}
              </Field>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => set({ searches: p.searches.filter((_, j) => j !== i) })}
              >
                Togli
              </Button>
            </div>
          ))}
          {nessunaRicerca && (
            <p className="text-sm text-muted">
              Nessuna ricerca. Premi <b>Aggiungi</b> per cominciare.
            </p>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <div>
          <Kicker as="div">irrinunciabili</Kicker>
          <p className="text-xs text-muted">
            Quello su cui non transigi. L'AI scarta o penalizza pesantemente chi non li rispetta.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Il confronto ignora le maiuscole: il file storico scriveva "ARREDATO" e la voce
              predefinita "Arredato", e comparivano come due pulsanti diversi per la stessa cosa. */}
          {unisciSenzaDoppioni(MUST_NOTI, p.musts).map((m) => {
            const attivo = p.musts.some((x) => x.toLowerCase() === m.toLowerCase());
            return (
              <Button
                key={m}
                size="sm"
                variant={attivo ? 'primary' : 'secondary'}
                onClick={() =>
                  set({
                    musts: attivo
                      ? p.musts.filter((x) => x.toLowerCase() !== m.toLowerCase())
                      : [...p.musts, m],
                  })
                }
              >
                {m}
              </Button>
            );
          })}
        </div>
      </Card>

      {citta.length > 0 && (
        <Card className="flex flex-col gap-4 p-4">
          <div>
            <Kicker as="div">zone</Kicker>
            <p className="text-xs text-muted">
              Filtro forte ma non assoluto: una casa ottima in una zona non elencata non viene
              buttata via, viene segnalata. Lascia vuoto per non filtrare per quartiere.
            </p>
          </div>
          {citta.map((c) => (
            <div key={c} className="flex flex-col gap-3 border-t border-hair pt-3 first:border-0 first:pt-0">
              <h4 className="text-sm text-ink capitalize">{c}</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <ChipList
                  label="Tieni"
                  tone="ok"
                  values={zonaDi(c).keep}
                  onChange={(keep) => setZona(c, { keep })}
                  placeholder="Crocetta, Cit Turin…"
                />
                <ChipList
                  label="Scarta"
                  tone="danger"
                  values={zonaDi(c).avoid}
                  onChange={(avoid) => setZona(c, { avoid })}
                  placeholder="Periferie, zone che non vuoi"
                />
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card className="flex flex-col gap-2 p-4">
        <div>
          <Kicker as="div">altro, in parole tue</Kicker>
          <p className="text-xs text-muted">
            Le sfumature che nessun campo prevede: "il centro solo se è sotto la metà del budget",
            "vicino alla metro conta parecchio". Scrivilo come lo diresti a una persona — è la parte
            che l'AI legge meglio.
          </p>
        </div>
        <textarea
          value={p.notes}
          onChange={(e) => set({ notes: e.target.value })}
          spellCheck={false}
          aria-label="Altro, in parole tue"
          className="h-40 w-full rounded-[var(--radius-card)] border border-line bg-surface-hi p-3 text-sm text-ink"
        />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} onClick={() => void salva()}>
          Salva
        </Button>
        {msg && <span className="text-xs text-ok">{msg}</span>}
        <span className="text-xs text-faint">
          Salvato in <code>data/local/</code>: resta su questo computer.
        </span>
      </div>

      <details className="text-sm text-muted">
        <summary className="cursor-pointer">
          <Kicker>cosa legge l'AI</Kicker>
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-hair bg-surface-hi p-3 text-xs">
          {generato}
        </pre>
      </details>
    </div>
  );
}
