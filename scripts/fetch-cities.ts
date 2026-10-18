/**
 * Rebuild data/mm-cities.json: the outline of each Metro Manila city (and
 * Pateros), from Nominatim. Only the snapshot scripts use it, to label
 * landmarks with the city they're in ("St. Joseph Parish · Las Piñas"), so
 * same-named places can be told apart. Not shipped with the app.
 *
 *   node --experimental-strip-types scripts/fetch-cities.ts
 *
 * One request per city, a second apart (Nominatim's usage policy).
 * Data © OpenStreetMap contributors, ODbL.
 */
import { writeFileSync } from "node:fs";

const CITIES = [
  "Caloocan", "Las Piñas", "Makati", "Malabon", "Mandaluyong", "Manila", "Marikina", "Muntinlupa", "Navotas",
  "Parañaque", "Pasay", "Pasig", "Pateros", "Quezon City", "San Juan", "Taguig", "Valenzuela",
];

type Geo = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
const round = (r: number[][]) => r.map(([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)]);

const out: { name: string; osmId: number; rings: number[][][] }[] = [];
for (const name of CITIES) {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: `${name}, Metro Manila, Philippines`,
    format: "jsonv2",
    polygon_geojson: "1",
    limit: "5",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": "patas/0.1 (city outlines)" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for ${name}`);
  const hits = (await res.json()) as { osm_type: string; osm_id: number; type: string; display_name: string; geojson: Geo }[];
  const hit = hits.find((h) => h.osm_type === "relation" && h.type === "administrative" && /Polygon/.test(h.geojson.type));
  if (!hit) throw new Error(`no administrative boundary for ${name}`);
  // Outer rings only: holes don't matter for "which city is this point in".
  const rings = hit.geojson.type === "Polygon" ? [round(hit.geojson.coordinates[0])] : hit.geojson.coordinates.map((p) => round(p[0]));
  out.push({ name, osmId: hit.osm_id, rings });
  console.log(`${name}: relation ${hit.osm_id}, ${rings.length} ring(s), ${rings.reduce((n, r) => n + r.length, 0)} points`);
  await new Promise((r) => setTimeout(r, 1100));
}

writeFileSync(
  "data/mm-cities.json",
  JSON.stringify({ source: "OpenStreetMap via Nominatim. © OpenStreetMap contributors, ODbL 1.0.", fetchedAt: new Date().toISOString(), cities: out }),
);
console.log(`wrote data/mm-cities.json (${out.length} cities)`);
