import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng, Landmark } from '../../types';

/**
 * Pezzi comuni alle due mappe (area da disegnare, annunci).
 *
 * Niente icone PNG di Leaflet: con un bundler i percorsi delle immagini di default si rompono e
 * i marker diventano quadratini vuoti. Si usano cerchi e `divIcon` disegnati in CSS.
 */

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Centro di ripiego quando non c'è niente da inquadrare: l'Italia. */
export const ITALY: LatLng = [42.5, 12.5];

export function createMap(el: HTMLElement, center: LatLng, zoom: number): L.Map {
  const map = L.map(el, { center, zoom, zoomControl: true, attributionControl: true });
  L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
  return map;
}

/** Il colore di un token del tema corrente (cambia fra chiaro e scuro). */
export function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function refMarker(r: Landmark): L.Marker {
  return L.marker([r.lat, r.lng], {
    icon: L.divIcon({ className: '', html: '<div class="hf-ref"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    keyboard: false,
    title: r.label,
  // Testo, non HTML: con una stringa Leaflet la mette in `innerHTML`, e l'etichetta la può
  // scrivere anche una proposta dell'agente.
  }).bindTooltip(Object.assign(document.createElement('span'), { textContent: r.label }), { direction: 'top', offset: [0, -10] });
}

export function areaLayer(polygon: LatLng[]): L.Polygon {
  const accent = themeColor('--accent', '#4a6b52');
  return L.polygon(polygon, { color: accent, weight: 2, fillColor: accent, fillOpacity: 0.12 });
}
