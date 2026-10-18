import type { LatLng } from "./types";
import { AREA_RING } from "./service-area.ts";

/**
 * Service area: Metro Manila (OSM relation 147488, src/lib/service-area.ts).
 *
 * Policy:
 *  - VENUES must be inside Metro Manila.
 *  - ORIGINS may be slightly outside, within ORIGIN_BUFFER_KM of the boundary:
 *    plenty of people who study or work there start from Rizal (Cainta,
 *    Taytay, San Mateo), Bulacan (Meycauayan) or Cavite (Bacoor).
 *
 * AREA_BBOX is the boundary's envelope, used as a cheap pre-filter and for
 * Overpass queries. It over-includes Manila Bay and parts of Rizal, Bulacan
 * and Cavite, so never use it alone as the scope test.
 */
export const ORIGIN_BUFFER_KM = 5;

const KM_PER_DEG_LAT = 111.32;

export const AREA_BBOX = (() => {
  const lats = AREA_RING.map(([, lat]) => lat);
  const lngs = AREA_RING.map(([lng]) => lng);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) };
})();

export function inBbox(p: LatLng, b = AREA_BBOX, bufferKm = 0): boolean {
  const dLat = bufferKm / KM_PER_DEG_LAT;
  const dLng = bufferKm / (KM_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180));
  return (
    p.lat >= b.south - dLat && p.lat <= b.north + dLat &&
    p.lng >= b.west - dLng && p.lng <= b.east + dLng
  );
}

/** Ray casting. `ring` is GeoJSON order [lng, lat]. */
export function pointInRing(p: LatLng, ring: [number, number][] = AREA_RING): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Approximate km from p to the nearest ring edge (local equirectangular; fine at city scale). */
export function kmToRing(p: LatLng, ring: [number, number][] = AREA_RING): number {
  const kx = KM_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
  const xy = ([lng, lat]: [number, number]) => [(lng - p.lng) * kx, (lat - p.lat) * KM_PER_DEG_LAT];
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = xy(ring[i - 1]);
    const [bx, by] = xy(ring[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export const venueInScope = (p: LatLng) => inBbox(p) && pointInRing(p);
export const originInScope = (p: LatLng) =>
  inBbox(p, AREA_BBOX, ORIGIN_BUFFER_KM) && (pointInRing(p) || kmToRing(p) <= ORIGIN_BUFFER_KM);

/** Overpass bbox clause: (south,west,north,east). */
export const areaOverpassBbox = () =>
  `(${AREA_BBOX.south},${AREA_BBOX.west},${AREA_BBOX.north},${AREA_BBOX.east})`;
