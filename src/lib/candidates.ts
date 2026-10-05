import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Origin, Venue } from "./types";
import { centroid, haversineKm } from "./scoring.ts";
import { qcOverpassBbox, venueInScope } from "./scope.ts";
import { snapToCell } from "./h3.ts";

/**
 * Candidate venues: public places that could be fair for the group, plus each
 * member's landmark as a "host at home/nearby" option.
 *
 * Sources (CANDIDATE_SOURCE):
 *  - snapshot (default): data/qc-venues.json, built offline by
 *    scripts/fetch-venues.ts. No network call, so members' cells go nowhere.
 *    Public Overpass was too slow for the request path (504s and 90 s+
 *    responses in the 2026-10-05 smoke test).
 *  - overpass: live Overpass query around the group.
 *  - google: Places API (New) searchNearby.
 * TODO(claude-code): add a curated allowlist (school, public libraries) per city.
 */

type SearchArea = { lat: number; lng: number; radiusM: number };

/** Centroid + radius covering the origins' spread. Only for the live sources. */
export function searchArea(origins: Origin[]): SearchArea {
  const pts = origins.map((o) => o.landmark);
  const seed = centroid(pts);
  const spreadKm = Math.max(...pts.map((p) => haversineKm(seed, p)));
  const radiusM = Math.round(Math.min(Math.max(spreadKm * 1000 * 0.6, 1500), 50000));
  return { ...seed, radiusM };
}

function hostOptions(origins: Origin[]): Venue[] {
  return origins.map((o) => ({
    venueId: `member:${o.memberId}`,
    name: `Near ${o.memberId}'s landmark`,
    location: o.landmark,
    tags: ["host"],
  }));
}

export async function findCandidates(origins: Origin[], max = 20): Promise<Venue[]> {
  const src = process.env.CANDIDATE_SOURCE ?? "snapshot";
  const publicVenues =
    src === "google" ? await googlePlaces(searchArea(origins), max)
    : src === "overpass" ? await overpass(searchArea(origins), max)
    : pickCandidates(loadSnapshot(), origins, max);
  // QC-only scope: drop venues (incl. host options) outside the service area.
  return [...publicVenues, ...hostOptions(origins)].filter((v) => venueInScope(v.location));
}

// ---------- Snapshot + selection ----------

/** Lower = preferred when several venues share one H3 cell (e.g. a mall and its food court). */
const CATEGORY_RANK: Record<string, number> = {
  library: 0, community_centre: 1, coworking: 2, "shop:mall": 3, cafe: 4, fast_food: 5, restaurant: 6,
};
const rank = (v: Venue) => CATEGORY_RANK[v.tags[0]] ?? 9;

/**
 * Pure: one venue per res-9 cell, keeping the best category. Venues in the
 * same ~200 m cell have near-identical travel times, so extras only burn
 * matrix elements.
 */
export function dedupeByCell(pool: Venue[]): Venue[] {
  const best = new Map<string, Venue>();
  for (const v of pool) {
    const c = snapToCell(v.location);
    const cur = best.get(c);
    if (!cur || rank(v) < rank(cur)) best.set(c, v);
  }
  return [...best.values()];
}

/**
 * Pure: the `max` venues with the smallest straight-line worst-case distance
 * to any origin (ties → smaller total). A minimax proxy, so the shortlist sits
 * where the fair answer is likely to be, not around the centroid.
 *
 * Road travel time can put the true optimum a few km from the straight-line
 * one, so picks are kept at least `minSepKm` apart to cover a wider area
 * instead of 20 venues on one block.
 */
export function pickCandidates(pool: Venue[], origins: Origin[], max: number, minSepKm = 0.4): Venue[] {
  const pts = origins.map((o) => o.landmark);
  const ranked = pool
    .map((v) => {
      const d = pts.map((p) => haversineKm(p, v.location));
      return { v, worst: Math.max(...d), total: d.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => a.worst - b.worst || a.total - b.total);
  const picked: Venue[] = [];
  for (const { v } of ranked) {
    if (picked.length >= max) break;
    if (picked.every((p) => haversineKm(p.location, v.location) >= minSepKm)) picked.push(v);
  }
  return picked;
}

export type VenueSnapshot = { source: string; osmBase: string; fetchedAt: string; venues: Venue[] };

let snapshotCache: Venue[] | null = null;
function loadSnapshot(): Venue[] {
  if (!snapshotCache) {
    const f = join(process.cwd(), process.env.VENUES_SNAPSHOT ?? "data/qc-venues.json");
    if (!existsSync(f)) throw new Error("venue snapshot missing; run scripts/fetch-venues.ts");
    const snap = JSON.parse(readFileSync(f, "utf8")) as VenueSnapshot;
    snapshotCache = dedupeByCell(snap.venues);
  }
  return snapshotCache;
}

// ---------- Overpass (OSM) ----------

/**
 * Venue tags worth meeting at. OSM also exposes tags Google doesn't, e.g.
 * internet_access=wlan — kept in `tags` for UI filtering.
 * Note: OSM opening_hours coverage in PH is spotty; don't filter on it.
 */
export const OVERPASS_FILTERS = [
  `nwr["amenity"~"^(cafe|library|fast_food|restaurant|community_centre|coworking_space)$"]["name"]`,
  `nwr["shop"="mall"]["name"]`,
  `nwr["office"="coworking"]["name"]`,
];

export function overpassQuery(a: SearchArea, max: number): string {
  // around ∩ QC bbox (Overpass intersects chained spatial filters)
  const around = `(around:${a.radiusM},${a.lat.toFixed(6)},${a.lng.toFixed(6)})${qcOverpassBbox()}`;
  return `[out:json][timeout:25];
(
${OVERPASS_FILTERS.map((f) => `  ${f}${around};`).join("\n")}
);
out center tags ${Math.max(max * 5, 50)};`;
}

export type OverpassEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** Pure: Overpass JSON → named venues, duplicates collapsed. tags[0] is the category. */
export function overpassToVenues(json: { elements?: OverpassEl[] }): Venue[] {
  const venues: Venue[] = [];
  const seen = new Set<string>();
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat == null || lng == null || !name) continue;
    // Not open to walk-in students: private access, or an institution's staff canteen.
    if (el.tags?.access === "private" || el.tags?.access === "no" || /\bcanteen\b/i.test(name)) continue;
    const dedupe = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const t = el.tags ?? {};
    const category =
      t.amenity === "coworking_space" || t.office === "coworking" ? "coworking"
      : t.shop === "mall" ? "shop:mall"
      : t.amenity; // matched the amenity filter (e.g. amenity=cafe + shop=bakery)
    const tags = [category, t.internet_access && `wifi:${t.internet_access}`].filter(Boolean) as string[];
    venues.push({ venueId: `osm:${el.type}/${el.id}`, name, location: { lat, lng }, tags });
  }
  return venues;
}

/** Pure: Overpass JSON → venues, nearest-to-seed first, capped. Exported for tests. */
export function parseOverpass(json: { elements?: OverpassEl[] }, a: SearchArea, max: number): Venue[] {
  return overpassToVenues(json)
    .map((v) => ({ v, d: haversineKm(a, v.location) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, max)
    .map((x) => x.v);
}

/**
 * Public Overpass instances are shared and rate-limited — fine for an MVP,
 * not for real traffic. Set OVERPASS_URL to a self-hosted/paid instance later.
 */
async function overpass(a: SearchArea, max: number): Promise<Venue[]> {
  const url = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass etiquette: identify the app; set OVERPASS_CONTACT to a contact URL/email.
      "User-Agent": `patas/0.1${process.env.OVERPASS_CONTACT ? ` (${process.env.OVERPASS_CONTACT})` : ""}`,
    },
    body: new URLSearchParams({ data: overpassQuery(a, max) }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return parseOverpass(await res.json(), a, max);
}

// ---------- Google Places (New) ----------

const GOOGLE_TYPES = ["cafe", "library", "shopping_mall", "restaurant"];

async function googlePlaces(a: SearchArea, max: number): Promise<Venue[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY not set");
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.types",
    },
    body: JSON.stringify({
      includedTypes: GOOGLE_TYPES, // TODO(claude-code): confirm against current Places docs
      maxResultCount: Math.min(max, 20),
      locationRestriction: {
        circle: { center: { latitude: a.lat, longitude: a.lng }, radius: a.radiusM },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}`);
  const data: {
    places?: Array<{
      id: string;
      displayName?: { text: string };
      location: { latitude: number; longitude: number };
      types?: string[];
    }>;
  } = await res.json();
  return (data.places ?? []).map((p) => ({
    venueId: p.id,
    name: p.displayName?.text ?? "Unnamed",
    location: { lat: p.location.latitude, lng: p.location.longitude },
    tags: p.types ?? [],
  }));
}
