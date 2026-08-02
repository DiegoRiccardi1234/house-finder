import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Field, Input } from '../ui/Field';
import { CityPicker } from './CityPicker';

/**
 * I gruppi Facebook da seguire, come lista invece che come JSON.
 *
 * Il resto del file (`market`, i commenti di esempio) viene riscritto tale e quale: chi modifica
 * i gruppi dalla UI non deve perdere pezzi che non stava guardando.
 */

interface Group {
  name: string;
  city: string;
  url: string;
}
type FbFile = { groups?: Group[] } & Record<string, unknown>;

export function FacebookGroups() {
  const [file, setFile] = useState<FbFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errore, setErrore] = useState('');

  const carica = useCallback(() => {
    api
      .getFacebook()
      .then((d) => setFile((d ?? {}) as FbFile))
      .catch((e: Error) => setErrore(e.message));
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
  const setGroups = (next: Group[]): void => setFile({ ...file, groups: next });

  async function salva(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      // Via le righe lasciate a metà: una riga senza indirizzo manderebbe lo scraper su una
      // pagina che non esiste, e l'errore arriverebbe a run avviata.
      const puliti = groups.filter((g) => g.url.trim() && g.name.trim());
      await api.putFacebook({ ...file, groups: puliti });
      setGroups(puliti);
      setMsg('Salvato.');
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        kicker="da dove leggere"
        title="Gruppi Facebook"
        action={
          <Button
            size="sm"
            onClick={() => setGroups([...groups, { name: '', city: '', url: '' }])}
          >
            Aggiungi
          </Button>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted">
          Apri il gruppo su Facebook e copia l'indirizzo dalla barra del browser. I gruppi privati
          mostrano i post solo ai membri: iscriviti <b>prima</b> di lanciare una scansione.
        </p>

        {groups.map((g, i) => (
          <div
            key={i}
            className="grid grid-cols-1 items-end gap-3 border-b border-hair pb-3 last:border-0 last:pb-0 md:grid-cols-[1.2fr_0.6fr_2fr_auto]"
          >
            <Field label="Nome">
              {(a) => (
                <Input
                  {...a}
                  value={g.name}
                  placeholder="Affitti privati Torino"
                  onChange={(e) =>
                    setGroups(groups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
              )}
            </Field>
            <Field label="Città">
              {/* Era il terzo campo città a testo libero dell'app: "Torino" qui e "torino" nella
                  ricerca erano due cose diverse, e nessuno lo diceva. */}
              {(a) => (
                <CityPicker
                  {...a}
                  value={g.city}
                  onChange={(city) =>
                    setGroups(groups.map((x, j) => (j === i ? { ...x, city } : x)))
                  }
                />
              )}
            </Field>
            <Field label="Indirizzo">
              {(a) => (
                <Input
                  {...a}
                  value={g.url}
                  placeholder="https://www.facebook.com/groups/…"
                  onChange={(e) =>
                    setGroups(groups.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                  }
                />
              )}
            </Field>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setGroups(groups.filter((_, j) => j !== i))}
            >
              Togli
            </Button>
          </div>
        ))}

        {groups.length === 0 && (
          <p className="text-sm text-muted">
            Nessun gruppo. Premi <b>Aggiungi</b>, oppure lascia stare: gli altri canali funzionano
            lo stesso.
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button size="sm" variant="primary" loading={busy} onClick={() => void salva()}>
            Salva
          </Button>
          {msg && <span className="text-xs text-ok">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}
