import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { CityZones, Profile, SearchRow } from '../types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Field, Input, Select } from '../ui/Field';
import { Kicker } from '../ui/Kicker';
import { ChipList } from './ChipList';
import { CityPicker, useCities } from './CityPicker';
import { SearchAssist } from './SearchAssist';
import { ZoneSuggest } from './ZoneSuggest';

/**
 * «La tua ricerca».
 *
 * Nella versione precedente chiedeva: città (testo libero), un'etichetta da inventare, il prezzo,
 * i locali minimi e i locali massimi. Cinque campi, di cui uno che rompeva il motore in silenzio
 * se scritto male e due che pretendevano di tradurre "bilocale" in `2` e `2` da soli — mentre il
 * titolo della sezione prometteva un campo "tipo di casa" che non esisteva.
 *
 * Ora: descrivi a parole e i campi si riempiono, oppure scegli città e tipo da due menu. Le
 * etichette si generano, i locali li imposta il tipo, i quartieri si spuntano.
 */

const MUST_NOTI = ['Arredato', 'Prezzo entro il tetto', 'Ascensore', 'Balcone', 'Animali ammessi'];

/** I tagli di casa, e cosa vogliono dire in numero di locali. */
const TIPI = [
  { id: 'stanza', label: 'Stanza singola', minRooms: 1, maxRooms: 1 },
  { id: 'bilocale', label: 'Bilocale', minRooms: 2, maxRooms: 2 },
  { id: 'trilocale', label: 'Trilocale', minRooms: 3, maxRooms: 3 },
  { id: 'quattro', label: 'Quattro locali o più', minRooms: 4, maxRooms: undefined },
  { id: 'condivisa', label: 'Casa da condividere', minRooms: 3, maxRooms: undefined },
  { id: 'qualsiasi', label: 'Qualsiasi', minRooms: undefined, maxRooms: undefined },
] as const;

type TipoId = (typeof TIPI)[number]['id'];

/** Dai locali salvati si risale al taglio: il profilo continua a contenere numeri, non nomi. */
function tipoDi(r: SearchRow): TipoId {
  const t = TIPI.find((x) => x.minRooms === r.minRooms && x.maxRooms === r.maxRooms);
  return t?.id ?? 'qualsiasi';
}

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
  const [msg, setMsg] = useState<{ tono: 'ok' | 'danger'; testo: string } | null>(null);
  const [caricamento, setCaricamento] = useState('');
  const cities = useCities();

  const etichettaCitta = useCallback(
    (slug: string) => cities.find((c) => c.slug === slug)?.label ?? slug,
    [cities],
  );

  const carica = useCallback(() => {
    api
      .getProfile()
      .then((s) => {
        setP(s.profile);
        setGenerato(s.generated);
      })
      .catch((e: Error) => setCaricamento(e.message));
  }, []);

  useEffect(carica, [carica]);

  const citta = useMemo(
    () => Array.from(new Set((p?.searches ?? []).map((s) => s.city))).filter(Boolean),
    [p?.searches],
  );

  if (caricamento) {
    return (
      <Alert tone="danger" title="Non riesco a leggere la tua ricerca">
        {caricamento}. Controlla che il server sia acceso, poi ricarica la pagina.
      </Alert>
    );
  }
  if (!p) return <p className="text-sm text-muted">Carico…</p>;

  const set = (patch: Partial<Profile>): void => setP({ ...p, ...patch });

  /** L'etichetta si ricalcola da città e taglio: era un campo da inventare, non è più chiesta. */
  const etichetta = (city: string, tipo: TipoId): string =>
    `${etichettaCitta(city)} · ${TIPI.find((t) => t.id === tipo)?.label.toLowerCase() ?? 'casa'}`;

  const setRiga = (i: number, patch: Partial<SearchRow>): void =>
    set({
      searches: p.searches.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        return { ...next, label: etichetta(next.city, tipoDi(next)) };
      }),
    });

  const setTipo = (i: number, tipo: TipoId): void => {
    const t = TIPI.find((x) => x.id === tipo);
    if (!t) return;
    setRiga(i, { minRooms: t.minRooms, maxRooms: t.maxRooms });
  };

  const zonaDi = (city: string): CityZones =>
    p.zones.find((z) => z.city === city) ?? { city, keep: [], avoid: [] };

  const setZona = (city: string, patch: Partial<CityZones>): void => {
    const altre = p.zones.filter((z) => z.city !== city);
    set({ zones: [...altre, { ...zonaDi(city), ...patch }] });
  };

  /** Quello che l'AI ha capito riempie i campi; il resto di ciò che c'era non si butta via. */
  const daAssistente = (parziale: Partial<Profile>): void => {
    const searches = (parziale.searches ?? []).map((r) => ({
      ...r,
      label: r.label || etichetta(r.city, tipoDi(r)),
    }));
    setP({
      searches: searches.length ? searches : p.searches,
      zones: parziale.zones?.length ? parziale.zones : p.zones,
      musts: parziale.musts?.length ? parziale.musts : p.musts,
      notes: parziale.notes?.trim() ? parziale.notes : p.notes,
    });
  };

  async function salva(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.putProfile(p as Profile);
      setP(s.profile);
      setGenerato(s.generated);
      setMsg({
        tono: 'ok',
        testo: s.skipped?.length
          ? `Salvato. Non ho tenuto ${s.skipped.length} riga/e incompleta/e.`
          : 'Salvato.',
      });
      onSaved?.();
    } catch (e) {
      // L'errore di scrittura NON sostituisce la schermata: le modifiche in corso restano dove
      // sono. Prima finiva nella stessa variabile del caricamento e portava via tutto il lavoro.
      setMsg({ tono: 'danger', testo: `Non sono riuscito a salvare: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const nessunaRicerca = p.searches.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <SearchAssist onFilled={daAssistente} />

      {nessunaRicerca && (
        <Alert tone="info" title="Non hai ancora detto cosa cerchi">
          Descrivi la tua ricerca qui sopra, oppure aggiungila a mano qui sotto: città, che tipo di
          casa e quanto vuoi spendere al massimo.
        </Alert>
      )}

      <Card>
        <CardHeader
          kicker="cosa cerchi"
          title="Città, tipo di casa e budget"
          action={
            <Button
              size="sm"
              onClick={() => {
                const city = citta[0] ?? '';
                set({
                  searches: [
                    ...p.searches,
                    {
                      id: '',
                      city,
                      label: city ? etichetta(city, 'bilocale') : '',
                      maxPrice: 700,
                      minRooms: 2,
                      maxRooms: 2,
                    },
                  ],
                });
              }}
            >
              Aggiungi
            </Button>
          }
        />
        <div className="flex flex-col gap-3 p-4">
          {p.searches.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-1 items-end gap-3 border-b border-hair pb-3 last:border-0 last:pb-0 md:grid-cols-[1.2fr_1.2fr_auto_auto]"
            >
              <Field label="Città">
                {(a) => <CityPicker {...a} value={r.city} onChange={(city) => setRiga(i, { city })} />}
              </Field>
              <Field label="Tipo di casa">
                {(a) => (
                  <Select {...a} value={tipoDi(r)} onChange={(e) => setTipo(i, e.target.value as TipoId)}>
                    {TIPI.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
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
              Nessuna ricerca. Premi <b>Aggiungi</b>, oppure descrivila a parole qui sopra.
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
          {unisciSenzaDoppioni(MUST_NOTI, p.musts).map((m) => {
            const attivo = p.musts.some((x) => x.toLowerCase() === m.toLowerCase());
            return (
              <Button
                key={m}
                size="sm"
                variant={attivo ? 'primary' : 'secondary'}
                aria-pressed={attivo}
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
              Non filtrano da sole: entrano nei criteri e le pesa l'AI, quindi una casa ottima in
              una zona che hai scartato viene segnalata invece che buttata via.
            </p>
          </div>
          {citta.map((c) => (
            <div key={c} className="flex flex-col gap-3 border-t border-hair pt-3 first:border-0 first:pt-0">
              <h4 className="text-sm text-ink">{etichettaCitta(c)}</h4>
              <ZoneSuggest
                city={c}
                keep={zonaDi(c).keep}
                avoid={zonaDi(c).avoid}
                onChange={(patch) => setZona(c, patch)}
              />
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">
                  <Kicker>aggiungine altri a mano</Kicker>
                </summary>
                <div className="mt-2 grid gap-4 md:grid-cols-2">
                  <ChipList
                    label="Tieni"
                    tone="ok"
                    values={zonaDi(c).keep}
                    onChange={(keep) => setZona(c, { keep })}
                  />
                  <ChipList
                    label="Scarta"
                    tone="danger"
                    values={zonaDi(c).avoid}
                    onChange={(avoid) => setZona(c, { avoid })}
                  />
                </div>
              </details>
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
          className="h-32 w-full rounded-[var(--radius-card)] border border-line bg-surface-hi p-3 text-sm text-ink"
        />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} onClick={() => void salva()}>
          Salva
        </Button>
        {msg && (
          <span className={msg.tono === 'ok' ? 'text-xs text-ok' : 'text-sm text-danger'}>
            {msg.testo}
          </span>
        )}
        <span className="text-xs text-faint">Resta su questo computer.</span>
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
