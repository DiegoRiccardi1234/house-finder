import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Tenant } from '../types';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Field, Input } from '../ui/Field';
import { CityPicker } from './CityPicker';

/**
 * I gruppi Facebook da seguire.
 *
 * Prima ogni gruppo era un modulo di tre campi con l'indirizzo intero in vista: sei gruppi
 * riempivano lo schermo. Ora è una lista corta, e si aggiunge incollando il link.
 *
 * Il resto del file (`market`, i commenti di esempio) viene riscritto tale e quale, tranne il
 * Marketplace che qui si accende e si spegne.
 */

interface Group {
  name: string;
  city: string;
  url: string;
}
interface Market {
  name: string;
  url: string;
}
type FbFile = { groups?: Group[]; market?: Market[] } & Record<string, unknown>;

const MARKETPLACE: Market = {
  name: 'Marketplace · affitti',
  url: 'https://www.facebook.com/marketplace/category/propertyrentals?sortBy=creation_time_descend&exact=false',
};

/** Un gruppo che nel nome dice "solo studenti" non serve a chi lavora (e viceversa per "lavoratori"). */
export function groupMismatch(name: string, tenant?: Tenant | null): string | null {
  if (!tenant) return null;
  const n = name.toLowerCase();
  if (tenant.occupazione !== 'studente' && /solo\s+studenti|studenti\s+universitari|universitari/.test(n) && !/lavorator/.test(n)) {
    return 'sembra solo per studenti';
  }
  if (tenant.occupazione === 'studente' && /solo\s+lavorator/.test(n)) return 'sembra solo per lavoratori';
  if (tenant.genere === 'uomo' && /solo\s+(ragazze|donne|studentesse)/.test(n)) return 'sembra solo per ragazze';
  if (tenant.genere === 'donna' && /solo\s+(ragazzi|uomini)/.test(n)) return 'sembra solo per ragazzi';
  return null;
}

/** Il nome di ripiego dal link: "torino.affitti.privati" → "torino affitti privati". */
function nameFromUrl(url: string): string {
  const m = url.match(/groups\/([^/?#]+)/);
  if (!m?.[1]) return '';
  return /^\d+$/.test(m[1]) ? `Gruppo ${m[1]}` : m[1].replace(/[._-]+/g, ' ');
}

export function FacebookGroups() {
  const [file, setFile] = useState<FbFile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errore, setErrore] = useState('');
  const [nuovo, setNuovo] = useState<Group>({ name: '', city: '', url: '' });
  const [sporco, setSporco] = useState(false);

  const carica = useCallback(() => {
    api
      .getFacebook()
      .then((d) => setFile((d ?? {}) as FbFile))
      .catch((e: Error) => setErrore(e.message));
    api.getProfile().then((s) => setTenant(s.profile.tenant ?? null)).catch(() => setTenant(null));
  }, []);

  useEffect(carica, [carica]);

  if (errore) {
    return (
      <Alert tone="danger" title="Non riesco a leggere i gruppi">
        {errore}
      </Alert>
    );
  }
  if (!file) return <p className="text-sm text-muted">Carico i gruppi…</p>;

  const groups = Array.isArray(file.groups) ? file.groups : [];
  const market = Array.isArray(file.market) ? file.market : [];
  const update = (next: Partial<FbFile>): void => {
    setFile({ ...file, ...next });
    setSporco(true);
    setMsg(null);
  };
  const urlValido = /^https:\/\/(www\.|m\.)?facebook\.com\/groups\/[^/\s]+/.test(nuovo.url.trim());

  async function salva(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      // Via le righe lasciate a metà: una riga senza indirizzo manderebbe lo scraper su una
      // pagina che non esiste, e l'errore arriverebbe a run avviata.
      const puliti = groups.filter((g) => g.url.trim() && g.name.trim() && g.city);
      await api.putFacebook({ ...file, groups: puliti, market });
      setFile({ ...file, groups: puliti });
      setSporco(false);
      setMsg('Salvato.');
    } catch (e) {
      setMsg(`Non salvato: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const fallback = groups.find((g) => g.city)?.city ?? '';

  return (
    <Card>
      <CardHeader title="Gruppi e Marketplace" />
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-[72ch] text-sm text-muted">
          I gruppi privati mostrano i post solo ai membri: iscriviti dal tuo account <b>prima</b> di cercare.
        </p>

        {groups.length > 0 ? (
          <ul className="flex flex-col divide-y divide-hair rounded-[var(--radius-btn)] border border-hair">
            {groups.map((g, i) => {
              const warn = groupMismatch(g.name, tenant);
              return (
                <li key={`${g.url}-${i}`} className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_10rem_auto_auto]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Input
                      aria-label={`Nome del gruppo ${i + 1}`}
                      value={g.name}
                      className="min-w-[12rem] flex-1 border-transparent bg-transparent px-1 hover:border-line focus:border-line"
                      onChange={(e) => update({ groups: groups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    />
                    {warn && <Badge tone="warn">{warn}</Badge>}
                  </div>
                  <CityPicker
                    aria-label={`Città del gruppo ${i + 1}`}
                    value={g.city}
                    onChange={(city) => update({ groups: groups.map((x, j) => (j === i ? { ...x, city } : x)) })}
                  />
                  <a href={g.url} target="_blank" rel="noreferrer" className="text-sm text-accent underline-offset-2 hover:underline">
                    Apri
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => update({ groups: groups.filter((_, j) => j !== i) })}>
                    Togli
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nessun gruppo. Aggiungine uno qui sotto, oppure lascia stare: gli altri canali funzionano lo stesso.</p>
        )}

        <form
          className="grid grid-cols-1 items-end gap-3 rounded-[var(--radius-btn)] bg-surface-3/50 p-3 md:grid-cols-[2fr_1.2fr_10rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!urlValido) return;
            const url = nuovo.url.trim().replace(/[?#].*$/, '');
            update({ groups: [...groups, { name: nuovo.name.trim() || nameFromUrl(url), city: nuovo.city || fallback, url }] });
            setNuovo({ name: '', city: nuovo.city, url: '' });
          }}
        >
          <Field label="Link del gruppo" hint="Aprilo su Facebook e copia l'indirizzo dalla barra del browser.">
            {(a) => <Input {...a} value={nuovo.url} placeholder="https://www.facebook.com/groups/…" onChange={(e) => setNuovo({ ...nuovo, url: e.target.value })} />}
          </Field>
          <Field label="Nome (facoltativo)">
            {(a) => <Input {...a} value={nuovo.name} placeholder="Affitti privati Torino" onChange={(e) => setNuovo({ ...nuovo, name: e.target.value })} />}
          </Field>
          <Field label="Città">
            {(a) => <CityPicker {...a} value={nuovo.city || fallback} onChange={(city) => setNuovo({ ...nuovo, city })} />}
          </Field>
          <Button size="sm" type="submit" disabled={!urlValido}>Aggiungi il gruppo</Button>
        </form>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--accent)]"
            checked={market.length > 0}
            onChange={(e) => update({ market: e.target.checked ? [MARKETPLACE] : [] })}
          />
          <span>
            Cerca anche nel Marketplace di Facebook
            <span className="block text-xs text-muted">Gli annunci di affitto vicino alla posizione del tuo account.</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" loading={busy} disabled={!sporco} onClick={() => void salva()}>
            Salva i gruppi
          </Button>
          <span role="status" className="text-sm text-muted">{msg ?? (sporco ? 'Modifiche non salvate.' : '')}</span>
        </div>
      </div>
    </Card>
  );
}
