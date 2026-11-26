import type { GeoPoint } from './types.js';
import type { LatLng } from '../config/profile.js';

/**
 * Geometria minima, tutta in locale: nessun servizio esterno per sapere se una casa sta dentro
 * l'area disegnata o quanto dista dal lavoro.
 */

const R_KM = 6371;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Distanza in linea d'aria, in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Punto dentro il poligono (ray casting). Il poligono è una lista di [lat, lng], chiuso o no:
 * l'ultimo lato torna comunque al primo punto. Su scala di quartiere la proiezione piana basta.
 */
export function insidePolygon(p: { lat: number; lng: number }, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i]!;
    const [yj, xj] = polygon[j]!;
    const crosses = yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Abbastanza preciso per decidere "dentro o fuori"? Un quartiere intero no. */
export function preciseEnough(g: GeoPoint | null | undefined): g is GeoPoint {
  return Boolean(g && (g.precision === 'address' || g.precision === 'street'));
}
