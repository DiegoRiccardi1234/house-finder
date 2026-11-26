import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { CityZones, Landmark, LatLng, Profile, SearchKind, SearchRow, Tenant } from '../types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Field, Input, Select } from '../ui/Field';
import { ChipList } from './ChipList';
import { CityPicker, useCities } from './CityPicker';
import { SearchAssist } from './SearchAssist';
import { ZoneSuggest } from './ZoneSuggest';

/**
 * «La tua ricerca», in blocchi nell'ordine in cui la racconteresti a voce: chi sei, cosa cerchi,
 * dove, cosa è irrinunciabile, e le sfumature per l'AI.
 *
 * Prima lavoro e distanza vivevano in una casella di testo libero, e la zona era solo un elenco di
 * nomi che l'AI pesava: una casa a 4 km restava in lista con un voto basso. Ora l'area si disegna
 * sulla mappa e scarta davvero; il punto di riferimento mette la distanza su ogni annuncio.
 */

// La mappa porta con sé Leaflet: si scarica solo quando si apre la sezione «Dove».
const AreaEditor = lazy(() => import('./map/AreaEditor'));

const MUST_NOTI = ['Arredato', 'Prezzo entro il tetto', 'Ascensore', 'Balcone', 'Animali ammessi'];

/** I tagli di casa, e cosa vogliono dire in numero di locali. */
const TIPI: { id: SearchKind; label: string; minRooms?: number; maxRooms?: number }[] = [
  { id: 'monolocale', label: 'Monolocale', minRooms: 1, maxRooms: 1 },
  { id: 'bilocale', label: 'Bilocale', minRooms: 2, maxRooms: 2 },
  { id: 'trilocale', label: 'Trilocale', minRooms: 3, maxRooms: 3 },
  { id: 'quattro', label: 'Quattro locali o più', minRooms: 4 },
  { id: 'stanza', label: 'Stanza in casa condivisa', minRooms: 1, maxRooms: 1 },
  { id: 'condivisa', label: 'Casa da condividere', minRooms: 3 },
  { id: 'qualsiasi', label: 'Qualsiasi' },
];

/** Il taglio salvato, o ricavato dai locali per i profili salvati prima che esistesse `tipo`. */
function tipoDi(r: SearchRow): SearchKind {
  if (r.tipo) return r.tipo;
  if (r.minRooms === 1 && r.maxRooms === 1 && /stanza|camera singola/i.test(r.label)) return 'stanza';
  return TIPI.find((x) => x.minRooms === r.minRooms && x.maxRooms === r.maxRooms)?.id ?? 'qualsiasi';
}

/**
 * Un suggerimento è già coperto se un irrinunciabile salvato comincia con le stesse parole:
 * «Arredato (scarta le case non arredate)» copre «Arredato». Prima comparivano tutti e due,
 * uno acceso e uno spento, e non si capiva quale contasse.
 */
const copre = (salvato: string, base: string): boolean => salvato.toLowerCase().startsWith(base.toLowerCase());

function Section({ title, intro, children, action }: { title: string; intro?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} action={action} />
      <div className="flex flex-col gap-4 p-4">
        {intro && <p className="max-w-[72ch] text-sm text-muted">{intro}</p>}
        {children}
      </div>
    </Card>
  );
}

function TriState({ label, value, onChange, yes, no, disabled }: { label: string; value: boolean | null | undefined; onChange: (v: boolean | null) => void; yes: string; no: string; disabled?: boolean }) {
  return (
    <Field label={label}>
      {(a) => (
        <Select {...a} disabled={disabled} value={value == null ? '' : value ? 'si' : 'no'} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'si')}>
          <option value="">Preferisco non dirlo</option>
          <option value="si">{yes}</option>
          <option value="no">{no}</option>
        </Select>
      )}
    </Field>
  );
}

/** Il punto di riferimento: si cerca l'indirizzo, si sceglie fra i risultati. */
function LandmarkPicker({ value, onChange, cityLabel }: { value?: Landmark | null; onChange: (l: Landmark | null) => void; cityLabel: string }) {
  const [label, setLabel] = useState(value?.label ?? 'Lavoro');
  const [q, setQ] = useState(value?.address ?? '');
  const [hits, setHits] = useState<Array<{ lat: number; lng: number; label: string }> | null>(null);
  const [busy, setBusy] = useState(false);

  async function cerca(): Promise<void> {
    if (q.trim().length < 3) return;
    setBusy(true);
    try {
      const testo = q.toLowerCase().includes(cityLabel.toLowerCase()) ? q : `${q}, ${cityLabel}`;
      setHits(await api.geoSearch(testo));
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[10rem_1fr_auto]">
        <Field label="Cos'è">
          {(a) => <Input {...a} value={label} maxLength={40} placeholder="Lavoro" onChange={(e) => { setLabel(e.target.value); if (value) onChange({ ...value, label: e.target.value || 'Riferimento' }); }} />}
        </Field>
        <Field label="Indirizzo">
          {(a) => (
            <Input
              {...a}
              value={q}
              placeholder="Corso Unione Sovietica 216"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void cerca(); } }}
            />
          )}
        </Field>
        <Button size="sm" loading={busy} onClick={() => void cerca()}>Cerca l'indirizzo</Button>
      </div>
      {hits && hits.length === 0 && <p className="text-xs text-danger">Nessun indirizzo trovato: prova a scriverlo per intero, con il civico.</p>}
      {hits && hits.length > 0 && (
        <ul className="flex flex-col gap-1">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lng}`}>
              <button
                type="button"
                className="text-left text-sm text-ink-soft underline-offset-2 hover:text-accent hover:underline"
                onClick={() => { onChange({ label: label || 'Riferimento', address: q, lat: h.lat, lng: h.lng }); setHits(null); }}
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && (
        <p className="text-xs text-muted">
          Riferimento: <b className="font-medium text-ink-soft">{value.label}</b>, {value.address}.{' '}
          <button type="button" className="underline hover:text-danger" onClick={() => onChange(null)}>Togli</button>
        </p>
      )}
    </div>
  );
}

/** Il centro della città, per aprire la mappa nel posto giusto prima di aver disegnato. */
function useCityCenter(label: string, enabled: boolean): LatLng | null {
  const [c, setC] = useState<LatLng | null>(null);
  useEffect(() => {
    if (!enabled || !label) return;
    let vivo = true;
    api.geoSearch(`${label}, Italia`).then((h) => { if (vivo && h[0]) setC([h[0].lat, h[0].lng]); }).catch(() => {});
    return () => { vivo = false; };
  }, [label, enabled]);
  return c;
}

function WhereCity({ zona, cityLabel, onZona }: { zona: CityZones; cityLabel: string; onZona: (patch: Partial<CityZones>) => void }) {
  const polygon = zona.area?.polygon ?? [];
  const center = useCityCenter(cityLabel, !zona.riferimento && polygon.length === 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-base text-ink">Punto di riferimento</h4>
        <p className="max-w-[72ch] text-sm text-muted">Il posto da cui misurare la distanza: il lavoro, l'università. Compare su ogni annuncio.</p>
        <LandmarkPicker value={zona.riferimento} cityLabel={cityLabel} onChange={(riferimento) => onZona({ riferimento })} />
      </div>
      <div className="flex flex-col gap-1">
        <h4 className="text-base text-ink">Area in cui cercare</h4>
        <p className="max-w-[72ch] text-sm text-muted">
          Clicca sulla mappa per disegnarla, come su Immobiliare. Un annuncio con la via fuori dall'area va fra gli
          scartati (lo ritrovi lì); uno che non dice la via resta, con «posizione da verificare».
        </p>
        <Suspense fallback={<p className="text-sm text-muted">Carico la mappa…</p>}>
          <AreaEditor polygon={polygon} riferimento={zona.riferimento} center={center} onChange={(p) => onZona({ area: p.length ? { polygon: p } : null })} />
        </Suspense>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-ink-soft">Quartieri preferiti e da evitare (li pesa l'AI)</summary>
        <div className="mt-3 flex flex-col gap-3">
          <ZoneSuggest city={zona.city} keep={zona.keep} avoid={zona.avoid} onChange={(patch) => onZona(patch)} />
          <div className="grid gap-4 md:grid-cols-2">
            <ChipList label="Preferiti, a mano" tone="ok" values={zona.keep} onChange={(keep) => onZona({ keep })} />
            <ChipList label="Da evitare, a mano" tone="danger" values={zona.avoid} onChange={(avoid) => onZona({ avoid })} />
          </div>
        </div>
      </details>
    </div>
  );
}

export function SearchEditor({ onSaved }: { onSaved?: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [salvato, setSalvato] = useState('');
  const [generato, setGenerato] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tono: 'ok' | 'danger'; testo: string } | null>(null);
  const [caricamento, setCaricamento] = useState('');
  const [aParole, setAParole] = useState(false);
  const cities = useCities();

  const etichettaCitta = useCallback((slug: string) => cities.find((c) => c.slug === slug)?.label ?? slug, [cities]);

  useEffect(() => {
    api
      .getProfile()
      .then((s) => {
        setP(s.profile);
        setSalvato(JSON.stringify(s.profile));
        setGenerato(s.generated);
        if (s.profile.searches.length === 0) setAParole(true);
      })
      .catch((e: Error) => setCaricamento(e.message));
  }, []);

  const sporco = p != null && JSON.stringify(p) !== salvato;

  // Chiudere la finestra con modifiche non salvate le perderebbe senza dire niente.
  useEffect(() => {
    if (!sporco) return;
    const avvisa = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', avvisa);
    return () => window.removeEventListener('beforeunload', avvisa);
  }, [sporco]);

  const citta = useMemo(() => Array.from(new Set((p?.searches ?? []).map((s) => s.city))).filter(Boolean), [p?.searches]);

  if (caricamento) {
    return (
      <Alert tone="danger" title="Non riesco a leggere la tua ricerca">
        {caricamento}. Controlla che il server sia acceso, poi ricarica la pagina.
      </Alert>
    );
  }
  if (!p) return <p className="text-sm text-muted">Carico…</p>;

  const set = (patch: Partial<Profile>): void => setP({ ...p, ...patch });
  // Nessuna occupazione presunta: «lavoratore» di default scartava i «solo studenti» a uno studente
  // che salvava senza guardare. Finché non si sceglie, il vincolo inquilino resta spento.
  const tenant = p.tenant ?? null;
  const setTenant = (patch: Partial<Tenant>): void => {
    if (tenant) set({ tenant: { ...tenant, ...patch } });
    else if (patch.occupazione) set({ tenant: { occupazione: patch.occupazione, ...patch } });
  };

  /** L'etichetta si ricalcola da città e taglio: era un campo da inventare, non è più chiesta. */
  const etichetta = (city: string, tipo: SearchKind): string =>
    `${etichettaCitta(city)} · ${TIPI.find((t) => t.id === tipo)?.label.toLowerCase() ?? 'casa'}`;

  const setRiga = (i: number, patch: Partial<SearchRow>): void =>
    set({
      searches: p.searches.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        return { ...next, label: etichetta(next.city, tipoDi(next)) };
      }),
    });

  const setTipo = (i: number, tipo: SearchKind): void => {
    const t = TIPI.find((x) => x.id === tipo);
    if (!t) return;
    set({
      searches: p.searches.map((row, index) => {
        if (index !== i) return row;
        const { minRooms: _a, maxRooms: _b, ...rest } = row;
        return {
          ...rest,
          tipo,
          label: etichetta(row.city, tipo),
          ...(t.minRooms != null ? { minRooms: t.minRooms } : {}),
          ...(t.maxRooms != null ? { maxRooms: t.maxRooms } : {}),
        };
      }),
    });
  };

  const zonaDi = (city: string): CityZones => p.zones.find((z) => z.city === city) ?? { city, keep: [], avoid: [] };
  const setZona = (city: string, patch: Partial<CityZones>): void => {
    const altre = p.zones.filter((z) => z.city !== city);
    set({ zones: [...altre, { ...zonaDi(city), ...patch }] });
  };

  /** Quello che l'AI ha capito riempie i campi; il resto di ciò che c'era non si butta via. */
  const daAssistente = (parziale: Partial<Profile>): void => {
    const searches = (parziale.searches ?? []).map((r) => ({ ...r, label: r.label || etichetta(r.city, tipoDi(r)) }));
    setP({
      ...p,
      searches: searches.length ? searches : p.searches,
      zones: parziale.zones?.length ? parziale.zones.map((z) => ({ ...zonaDi(z.city), ...z })) : p.zones,
      musts: parziale.musts?.length ? parziale.musts : p.musts,
      notes: parziale.notes?.trim() ? parziale.notes : p.notes,
    });
  };

  async function salva(): Promise<void> {
    if (!p) return;
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.putProfile({ ...p, tenant });
      setP(s.profile);
      setSalvato(JSON.stringify(s.profile));
      setGenerato(s.generated);
      setMsg({
        tono: 'ok',
        testo: s.skipped?.length ? `Salvato. Non ho tenuto ${s.skipped.length} riga/e incompleta/e.` : 'Salvato. Gli annunci già trovati sono stati ricontrollati con le regole nuove.',
      });
      onSaved?.();
    } catch (e) {
      // L'errore di scrittura NON sostituisce la schermata: le modifiche in corso restano dove sono.
      setMsg({ tono: 'danger', testo: `Non sono riuscito a salvare: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const nessunaRicerca = p.searches.length === 0;
  const suggerimenti = MUST_NOTI.filter((m) => !p.musts.some((x) => copre(x, m)));

  return (
    <div className="flex flex-col gap-4 pb-20">
      {aParole ? (
        <SearchAssist onFilled={(x) => { daAssistente(x); }} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => setAParole(true)}>Descrivi la ricerca a parole</Button>
          <span className="text-xs text-muted">L'AI compila i campi qui sotto; niente si salva finché non premi Salva.</span>
        </div>
      )}

      {nessunaRicerca && (
        <Alert tone="info" title="Non hai ancora detto cosa cerchi">
          Descrivi la tua ricerca qui sopra, oppure aggiungila a mano qui sotto: città, che tipo di casa e quanto vuoi spendere al massimo.
        </Alert>
      )}

      <Section
        title="Chi cerca casa"
        intro="Serve a riconoscere gli annunci che ti escludono («solo studenti», «solo ragazze», «no animali»). Non esce da questo computer."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Occupazione" hint={tenant ? undefined : 'Finché non la scegli, i vincoli sull\'inquilino non vengono controllati.'}>
            {(a) => (
              <Select
                {...a}
                value={tenant?.occupazione ?? ''}
                onChange={(e) => (e.target.value ? setTenant({ occupazione: e.target.value as Tenant['occupazione'] }) : set({ tenant: null }))}
              >
                <option value="">Scegli…</option>
                <option value="lavoratore">Lavoro</option>
                <option value="studente">Studio</option>
                <option value="altro">Altro</option>
              </Select>
            )}
          </Field>
          <Field label="Genere">
            {(a) => (
              <Select {...a} disabled={!tenant} value={tenant?.genere ?? ''} onChange={(e) => setTenant({ genere: (e.target.value || null) as Tenant['genere'] })}>
                <option value="">Preferisco non dirlo</option>
                <option value="donna">Donna</option>
                <option value="uomo">Uomo</option>
              </Select>
            )}
          </Field>
          <TriState label="Animali" disabled={!tenant} value={tenant?.animali} yes="Ho animali" no="Niente animali" onChange={(v) => setTenant({ animali: v })} />
          <TriState label="Fumo" disabled={!tenant} value={tenant?.fumatore} yes="Fumo" no="Non fumo" onChange={(v) => setTenant({ fumatore: v })} />
        </div>
        <Field label={`Annunci che ti escludono: tienili come «Da chiedere» se il voto è almeno ${p.askThreshold ?? 70}`} hint="Sotto questo voto vanno fra gli scartati. Sopra, restano con un messaggio pronto per chiedere se affittano anche a te.">
          {(a) => (
            <input {...a} type="range" min={40} max={95} step={5} value={p.askThreshold ?? 70} onChange={(e) => set({ askThreshold: Number(e.target.value) })} className="w-full max-w-md accent-[var(--accent)]" />
          )}
        </Field>
      </Section>

      <Section
        title="Cosa cerchi"
        intro="Città, tipo di casa e tetto di prezzo. I tipi che non scegli vengono scartati in automatico: se cerchi mono e bilocali, i trilocali non li vedi."
        action={
          <Button
            size="sm"
            onClick={() => {
              const city = citta[0] ?? '';
              set({ searches: [...p.searches, { id: '', city, label: city ? etichetta(city, 'bilocale') : '', maxPrice: 700, minRooms: 2, maxRooms: 2, tipo: 'bilocale' }] });
            }}
          >
            Aggiungi un tipo di casa
          </Button>
        }
      >
        {p.searches.map((r, i) => (
          <div key={i} className="grid grid-cols-1 items-end gap-3 border-b border-hair pb-3 last:border-0 last:pb-0 md:grid-cols-[1.2fr_1.2fr_auto_auto]">
            <Field label="Città">
              {(a) => <CityPicker {...a} value={r.city} onChange={(city) => setRiga(i, { city })} />}
            </Field>
            <Field label="Tipo di casa">
              {(a) => (
                <Select {...a} value={tipoDi(r)} onChange={(e) => setTipo(i, e.target.value as SearchKind)}>
                  {TIPI.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Al massimo (€/mese)">
              {(a) => <Input {...a} type="number" min={1} step={10} value={r.maxPrice} onChange={(e) => setRiga(i, { maxPrice: Number(e.target.value) })} className="w-32" />}
            </Field>
            <Button size="sm" variant="ghost" onClick={() => set({ searches: p.searches.filter((_, j) => j !== i) })}>Togli</Button>
          </div>
        ))}
        {nessunaRicerca && <p className="text-sm text-muted">Nessun tipo di casa. Premi «Aggiungi un tipo di casa».</p>}
      </Section>

      {citta.map((c) => (
        <Section key={c} title={citta.length > 1 ? `Dove, a ${etichettaCitta(c)}` : 'Dove'}>
          <WhereCity zona={zonaDi(c)} cityLabel={etichettaCitta(c)} onZona={(patch) => setZona(c, patch)} />
        </Section>
      ))}

      <Section title="Irrinunciabili" intro="Quello su cui non transigi: l'AI penalizza forte chi non li rispetta.">
        <ul className="flex flex-col gap-2">
          {p.musts.map((m) => (
            <li key={m}>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" checked onChange={() => set({ musts: p.musts.filter((x) => x !== m) })} className="mt-0.5 accent-[var(--accent)]" />
                {m}
              </label>
            </li>
          ))}
          {suggerimenti.map((m) => (
            <li key={m}>
              <label className="flex items-start gap-2 text-sm text-muted">
                <input type="checkbox" checked={false} onChange={() => set({ musts: [...p.musts, m] })} className="mt-0.5 accent-[var(--accent)]" />
                {m}
              </label>
            </li>
          ))}
        </ul>
        <ChipList label="Aggiungine uno tuo" tone="ok" values={[]} onChange={(v) => { const nuovi = v.filter((x) => !p.musts.includes(x)); if (nuovi.length) set({ musts: [...p.musts, ...nuovi] }); }} />
      </Section>

      <Card>
        <details className="group">
          <summary className="cursor-pointer px-4 py-3 text-lg text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            Istruzioni per l'AI, in parole tue
          </summary>
          <div className="flex flex-col gap-2 border-t border-hair p-4">
            <p className="max-w-[72ch] text-sm text-muted">
              Le sfumature che nessun campo prevede: «il centro solo se è sotto la metà del budget», «vicino alla metro conta
              parecchio». Scrivilo come lo diresti a una persona.
            </p>
            <textarea
              value={p.notes}
              onChange={(e) => set({ notes: e.target.value })}
              spellCheck={false}
              aria-label="Istruzioni per l'AI"
              className="h-44 w-full rounded-[var(--radius-card)] border border-line bg-surface-hi p-3 text-sm text-ink"
            />
            <details className="text-sm text-muted">
              <summary className="cursor-pointer">Cosa legge davvero l'AI</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-hair bg-surface-hi p-3 text-xs">{generato}</pre>
            </details>
          </div>
        </details>
      </Card>

      <div className="sticky bottom-2 z-[1100] flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[0_6px_18px_rgba(20,24,26,0.08)]">
        <Button variant="primary" loading={busy} disabled={!sporco && !nessunaRicerca} onClick={() => void salva()}>
          Salva la ricerca
        </Button>
        {msg ? (
          <span role="status" className={msg.tono === 'ok' ? 'text-sm text-ok' : 'text-sm text-danger'}>{msg.testo}</span>
        ) : (
          <span className="text-sm text-muted">{sporco ? 'Modifiche non salvate.' : 'Tutto salvato. Resta su questo computer.'}</span>
        )}
      </div>
    </div>
  );
}
