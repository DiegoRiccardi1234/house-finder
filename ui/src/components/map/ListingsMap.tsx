import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { CityZones, StoredListing } from '../../types';
import { areaLayer, createMap, ITALY, refMarker, themeColor } from './leafletBase';
import { safeHref } from '../../api';

/**
 * Gli annunci sulla mappa: un pallino per annuncio, colorato per voto, con l'area disegnata e il
 * punto di riferimento sotto. Si vede a colpo d'occhio cosa è vicino e cosa no.
 * Gli annunci senza posizione non compaiono: lo dice la riga sotto la mappa.
 */
export default function ListingsMap({ items, zones }: { items: StoredListing[]; zones: CityZones[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = createMap(el.current, ITALY, 6);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const placed = items.filter((r) => r.geo);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const z of zones) {
      if (z.area?.polygon && z.area.polygon.length >= 3) {
        areaLayer(z.area.polygon).addTo(g);
        bounds.push(...z.area.polygon);
      }
      if (z.riferimento) {
        refMarker(z.riferimento).addTo(g);
        bounds.push([z.riferimento.lat, z.riferimento.lng]);
      }
    }
    const good = themeColor('--ok', '#2f7d4f');
    const mid = themeColor('--warn', '#a8730f');
    const low = themeColor('--sand-500', '#7d7d72');
    for (const r of placed) {
      const score = r.ai?.score ?? 0;
      const color = score >= 65 ? good : score >= 40 ? mid : low;
      const price = r.listing.price ?? r.fields?.prezzo;
      const dot = L.circleMarker([r.geo!.lat, r.geo!.lng], {
        radius: r.geo!.precision === 'zone' ? 6 : 8,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: r.status === 'dismissed' ? 0.35 : 0.95,
        dashArray: r.geo!.precision === 'zone' ? '3 3' : undefined,
      });
      const box = document.createElement('div');
      const a = document.createElement('a');
      a.href = safeHref(r.listing.url);
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = r.listing.title;
      a.style.fontWeight = '600';
      box.append(a);
      const info = document.createElement('div');
      info.textContent = [
        price != null ? `€${price}/mese` : null,
        r.ai ? `voto ${r.ai.score}` : null,
        r.distanceKm != null ? `${r.distanceKm.toLocaleString('it-IT')} km` : null,
        r.geo!.precision === 'zone' ? 'posizione approssimata' : null,
      ].filter(Boolean).join(' · ');
      box.append(info);
      dot.bindPopup(box);
      dot.addTo(g);
      bounds.push([r.geo!.lat, r.geo!.lng]);
    }
    if (bounds.length) m.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 15 });
  }, [items, zones]);

  return (
    <div className="flex flex-col gap-2">
      <div ref={el} className="hf-map h-[60vh] min-h-[360px] w-full" aria-label="Mappa degli annunci" />
      <p className="text-xs text-muted">
        {placed.length} annunci su {items.length} hanno una posizione. Verde = voto alto, giallo = medio, grigio = basso;
        bordo tratteggiato = posizione approssimata. Il rombo è il tuo punto di riferimento.
      </p>
    </div>
  );
}
