import type { Origin, Venue } from "./types";
import { centroid, haversineKm } from "./scoring.ts";
import { qcOverpassBbox, venueInScope } from "./scope.ts";

/**
 * Candidate venues: public places near the group, plus each member's
 * landmark as a "host at home/nearby" option.
 *
 * The centroid is only a search SEED. The search radius covers the spread of
 * origins so the fair answer isn't excluded just because it's off-centre.
 *
 * Sources: Overpass (OSM, default) or Google Places (New).
 * Select with CANDIDATE_SOURCE=overpass|google.
 * TODO(claude-code): add a curated allowlist (school, public libraries) per city.
 */

type SearchArea = { lat: number; lng: number; radiusM: number };

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
  const area = searchArea(origins);
  const publicVenues =
    process.env.CANDIDATE_SOURCE === "google"
      ? await googlePlaces(area, max)
      : await overpass(area, max);
  // QC-only scope: drop venues (incl. host options) outside the service area.
  return [...publicVenues, ...hostOptions(origins)].filter((v) => venueInScope(v.location));
}

// ---------- Overpass (OSM) ----------

/**
 * Venue tags worth meeting at. OSM also exposes tags Google doesn't, e.g.
 * internet_access=wlan — kept in `tags` for UI filtering.
 * Note: OSM opening_hours coverage in PH is spotty; don't filter on it.
 */
export function overpassQuery(a: SearchArea, max: number): string {
  // around ∩ QC bbox (Overpass intersects chained spatial filters)
  const around = `(around:${a.radiusM},${a.lat.toFixed(6)},${a.lng.toFixed(6)})${qcOverpassBbox()}`;
  return `[out:json][timeout:25];
(
  nwr["amenity"~"^(cafe|library|fast_food|restaurant|community_centre)$"]["name"]${around};
  nwr["shop"="mall"]["name"]${around};
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

/** Pure: Overpass JSON → venues, nearest-to-seed first, capped. Exported for tests. */
export function parseOverpass(json: { elements?: OverpassEl[] }, a: SearchArea, max: number): Venue[] {
  const venues: (Venue & { d: number })[] = [];
  const seen = new Set<string>();
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat == null || lng == null || !name) continue;
    const dedupe = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const t = el.tags ?? {};
    const tags = [t.amenity, t.shop && `shop:${t.shop}`, t.internet_access && `wifi:${t.internet_access}`]
      .filter(Boolean) as string[];
    venues.push({
      venueId: `osm:${el.type}/${el.id}`,
      name,
      location: { lat, lng },
      tags,
      d: haversineKm(a, { lat, lng }),
    });
  }
  return venues
    .sort((x, y) => x.d - y.d)
    .slice(0, max)
    .map(({ d: _d, ...v }) => v);
}

/**
 * Public Overpass instances are shared and rate-limited — fine for an MVP,
 * not for real traffic. Set OVERPASS_URL to a self-hosted/paid instance later.
 */
async function overpass(a: SearchArea, max: number): Promise<Venue[]> {
  const url = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass etiquette: identify the app; set OVERPASS_CONTACT to a contact URL/email.
      "User-Agent": `patas/0.1${process.env.OVERPASS_CONTACT ? ` (${process.env.OVERPASS_CONTACT})` : ""}`,
    },
    body: new URLSearchParams({ data: overpassQuery(a, max) }),
    cache: "no-store",
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
