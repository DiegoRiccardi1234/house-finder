import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Landmark, LatLng } from '../../types';
import { Button } from '../../ui/Button';
import { areaLayer, createMap, ITALY, refMarker } from './leafletBase';

/**
 * Disegna l'area in cui cercare, come su Immobiliare: un clic sulla mappa aggiunge un punto,
 * i punti si trascinano per correggere, l'area si chiude da sola fra l'ultimo e il primo.
 *
 * Fuori dall'area un annuncio con la via nota viene scartato in automatico (si può ripescare).
 * Un annuncio senza via resta, con "posizione da verificare".
 */
export default function AreaEditor({
  polygon,
  onChange,
  riferimento,
  center,
}: {
  polygon: LatLng[];
  onChange: (p: LatLng[]) => void;
  riferimento?: Landmark | null;
  /** Dove guardare se non c'è ancora niente di disegnato (la città). */
  center?: LatLng | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const points = useRef<LatLng[]>(polygon);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // La mappa nasce una volta sola; i dati la ridisegnano sotto.
  useEffect(() => {
    if (!el.current || map.current) return;
    const start: LatLng = polygon[0] ?? (riferimento ? [riferimento.lat, riferimento.lng] : center ?? ITALY);
    const m = createMap(el.current, start, polygon.length || riferimento || center ? 13 : 6);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const next: LatLng = [round(e.latlng.lat), round(e.latlng.lng)];
      onChangeRef.current([...points.current, next]);
    });
    if (polygon.length >= 3) m.fitBounds(L.latLngBounds(polygon), { padding: [24, 24] });
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    points.current = polygon;
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    if (polygon.length >= 3) areaLayer(polygon).addTo(g);
    else if (polygon.length === 2) L.polyline(polygon, { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a6b52', weight: 2, dashArray: '4 4' }).addTo(g);
    polygon.forEach((p, i) => {
      const v = L.marker(p, {
        draggable: true,
        keyboard: false,
        icon: L.divIcon({ className: '', html: '<div class="hf-vertex"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
        title: `Punto ${i + 1}: trascina per spostarlo`,
      });
      v.on('dragend', () => {
        const ll = v.getLatLng();
        const next = points.current.map((q, j) => (j === i ? ([round(ll.lat), round(ll.lng)] as LatLng) : q));
        onChangeRef.current(next);
      });
      v.addTo(g);
    });
    if (riferimento) refMarker(riferimento).addTo(g);
  }, [polygon, riferimento]);

  // Un riferimento nuovo, prima di aver disegnato: la mappa ci va sopra.
  useEffect(() => {
    if (riferimento && map.current && polygon.length === 0) map.current.setView([riferimento.lat, riferimento.lng], 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riferimento?.lat, riferimento?.lng]);

  return (
    <div className="flex flex-col gap-2">
      <div ref={el} className="hf-map h-[360px] w-full sm:h-[440px]" aria-label="Mappa: clicca per aggiungere i punti dell'area" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!polygon.length} onClick={() => onChange(polygon.slice(0, -1))}>
          Togli l'ultimo punto
        </Button>
        <Button size="sm" variant="ghost" disabled={!polygon.length} onClick={() => onChange([])}>
          Cancella l'area
        </Button>
        {polygon.length >= 3 && map.current && (
          <Button size="sm" variant="ghost" onClick={() => map.current?.fitBounds(L.latLngBounds(polygon), { padding: [24, 24] })}>
            Inquadra l'area
          </Button>
        )}
        <p className="text-xs text-muted">
          {polygon.length === 0
            ? 'Clicca sulla mappa per mettere il primo punto.'
            : polygon.length < 3
              ? `Ancora ${3 - polygon.length} ${polygon.length === 2 ? 'punto' : 'punti'} e l'area si chiude.`
              : `Area di ${polygon.length} punti. Trascina un punto per correggerla.`}
        </p>
      </div>
    </div>
  );
}

const round = (n: number): number => Math.round(n * 1e5) / 1e5;
