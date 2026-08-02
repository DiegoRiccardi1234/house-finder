import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CityOption } from '../types';
import { Select } from '../ui/Field';

/**
 * La scelta della città.
 *
 * Era un campo di testo con placeholder `torino`. Chi scriveva "Milano" salvava senza un avviso,
 * e lo scraper chiedeva `https://www.subito.it/undefined`: nessun errore, nessun annuncio, e
 * nessun modo di capire perché. Ora si sceglie da un elenco, e la città che non c'è semplicemente
 * non si può scrivere.
 *
 * L'elenco arriva una volta sola e resta: sono 109 voci, e ricaricarle a ogni riga di ricerca
 * significherebbe una richiesta per ogni tasto premuto altrove nel modulo.
 */

let cache: CityOption[] | null = null;

export function useCities(): CityOption[] {
  const [cities, setCities] = useState<CityOption[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    let vivo = true;
    api
      .cities()
      .then((c) => {
        cache = c;
        if (vivo) setCities(c);
      })
      .catch(() => {
        /* senza elenco il menu resta vuoto: lo dice il posto vuoto, non un errore rosso */
      });
    return () => {
      vivo = false;
    };
  }, []);
  return cities;
}

export function CityPicker({
  value,
  onChange,
  id,
  ...rest
}: {
  value: string;
  onChange: (slug: string) => void;
  id?: string;
  'aria-describedby'?: string;
}) {
  const cities = useCities();

  return (
    <Select {...rest} id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Scegli la città…</option>
      {cities.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.label}
        </option>
      ))}
      {/* Una città salvata prima e non più nell'elenco resterebbe invisibile: meglio mostrarla
          marcata che farla sparire dal menu senza dire niente. */}
      {value && !cities.some((c) => c.slug === value) && (
        <option value={value}>{value} (non più disponibile)</option>
      )}
    </Select>
  );
}
