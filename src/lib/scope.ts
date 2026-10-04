import type { LatLng } from "./types";

/**
 * Service area: Quezon City only (MVP).
 *
 * Policy:
 *  - VENUES must be inside QC.
 *  - ORIGINS may be slightly outside (students at QC schools often live in
 *    Caloocan, San Mateo, Marikina, San Juan) — allowed within ORIGIN_BUFFER_KM.
 *
 * QC_BBOX is a rough envelope, NOT the boundary. It over-includes parts of
 * Caloocan, Manila, San Juan, Marikina, Pasig.
 * TODO(claude-code): replace with the QC admin boundary polygon from OSM
 * (relation for Quezon City; verify admin_level) stored as static GeoJSON,
 * plus point-in-polygon. Keep the bbox as a cheap pre-filter.
 */
export const QC_BBOX = { south: 14.58, north: 14.78, west: 120.98, east: 121.14 } as const;
export const ORIGIN_BUFFER_KM = 5;

const KM_PER_DEG_LAT = 111.32;

export function inBbox(p: LatLng, b = QC_BBOX, bufferKm = 0): boolean {
  const dLat = bufferKm / KM_PER_DEG_LAT;
  const dLng = bufferKm / (KM_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180));
  return (
    p.lat >= b.south - dLat && p.lat <= b.north + dLat &&
    p.lng >= b.west - dLng && p.lng <= b.east + dLng
  );
}

export const venueInScope = (p: LatLng) => inBbox(p);
export const originInScope = (p: LatLng) => inBbox(p, QC_BBOX, ORIGIN_BUFFER_KM);

/** Overpass bbox clause: (south,west,north,east). */
export const qcOverpassBbox = () =>
  `(${QC_BBOX.south},${QC_BBOX.west},${QC_BBOX.north},${QC_BBOX.east})`;
