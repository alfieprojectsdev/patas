import type { CostMatrix, LatLng, TravelMode } from "./types";
import { haversineKm } from "./scoring.ts";

/**
 * Provider seam. Default is OpenRouteService (OSM data, free tier) for the
 * MVP; Google is a fallback; self-hosted OSRM/Valhalla is the privacy upgrade
 * (coords never leave our server); a Sakay.ph-backed provider is the intended
 * TRANSIT upgrade if a data partnership happens.
 * Select with ROUTING_PROVIDER=ors|google|estimate (default ors; estimate = no-key dev mode).
 */
export interface MatrixProvider {
  name: string;
  supports: TravelMode[];
  minutes(origins: LatLng[], destinations: LatLng[], mode: TravelMode, departureTime?: Date): Promise<CostMatrix>;
}

export const googleProvider: MatrixProvider = {
  name: "google-routes",
  supports: ["DRIVE", "WALK", "TRANSIT", "TWO_WHEELER"],
  minutes: (o, d, m, t) => travelMinutes(o, d, m, t),
};

// ---------- OpenRouteService (OSM) ----------

/**
 * ORS has no motorcycle or transit profile, so it supports DRIVE and WALK
 * only. (TWO_WHEELER used to map to driving-car, which showed car times under
 * a "Motorcycle" label; removed 2026-10-07. Google Routes has a real one.)
 */
const ORS_PROFILE: Partial<Record<TravelMode, string>> = {
  DRIVE: "driving-car",
  WALK: "foot-walking",
};

/** Pure: ORS matrix response → minutes matrix. Exported for tests. */
export function parseOrsMatrix(json: { durations?: (number | null)[][] }, n: number, m: number): CostMatrix {
  const d = json.durations;
  if (!d || d.length !== n || d.some((row) => row.length !== m)) {
    throw new Error("ORS matrix shape mismatch");
  }
  return d.map((row) => row.map((s) => (s == null ? null : s / 60)));
}

/**
 * ORS matrix: POST /v2/matrix/{profile}, locations as [lng, lat] (note order),
 * sources/destinations as indices into one combined locations array.
 * ORS ignores departure time — durations are typical, not traffic-aware.
 *
 * Limits (openrouteservice.org/restrictions, 2026-10-05): 3,500 origin ×
 * destination elements per request. The API sends at most 10 × 30 = 300.
 * Daily/per-minute quotas are per plan; check the HeiGIT dashboard before
 * running scripts/precompute.ts.
 *
 * Terms (account.heigit.org/info/tos): no personal data in requests, so
 * only H3 cell centres go out, never a member's landmark. Results are
 * CC-BY-SA 4.0 and must be shown with ORS_ATTRIBUTION.
 */
export const ORS_ATTRIBUTION = "© openrouteservice by HeiGIT | Data from OpenStreetMap";
const ORS_BASE = process.env.ORS_BASE_URL || "https://api.heigit.org/openrouteservice";

export const orsProvider: MatrixProvider = {
  name: "openrouteservice",
  supports: ["DRIVE", "WALK"],
  async minutes(origins, destinations, mode) {
    const key = process.env.ORS_API_KEY;
    if (!key) throw new Error("ORS_API_KEY not set");
    const profile = ORS_PROFILE[mode];
    if (!profile) throw new Error(`ORS does not support mode ${mode}`);

    const locations = [...origins, ...destinations].map((p) => [p.lng, p.lat]);
    const n = origins.length;
    const m = destinations.length;

    const res = await fetch(`${ORS_BASE}/v2/matrix/${profile}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({
        locations,
        sources: [...Array(n).keys()],
        destinations: [...Array(m).keys()].map((j) => n + j),
        metrics: ["duration"],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`ORS ${res.status}`); // no body echo
    return parseOrsMatrix(await res.json(), n, m);
  },
};

// ---------- Straight-line estimate (dev only) ----------

/**
 * Lets the app run end to end with no API key: haversine km × a detour factor
 * ÷ a flat speed. The speeds are placeholders, not measurements, so this is
 * only for local development and demos, and the UI labels it as such. Never
 * the default.
 */
const EST_DETOUR = 1.35;
const EST_KMH: Partial<Record<TravelMode, number>> = { DRIVE: 20, WALK: 4.5 };

export function estimateMatrix(origins: LatLng[], destinations: LatLng[], mode: TravelMode): CostMatrix {
  const kmh = EST_KMH[mode];
  if (!kmh) throw new Error(`estimate does not support mode ${mode}`);
  return origins.map((o) => destinations.map((d) => (haversineKm(o, d) * EST_DETOUR * 60) / kmh));
}

export const estimateProvider: MatrixProvider = {
  name: "straight-line-estimate",
  supports: ["DRIVE", "WALK"],
  minutes: async (o, d, m) => estimateMatrix(o, d, m),
};

export function getProvider(): MatrixProvider {
  switch (process.env.ROUTING_PROVIDER) {
    case "google": return googleProvider;
    case "estimate": return estimateProvider;
    default: return orsProvider;
  }
}

/**
 * Travel-time matrix via Google Routes API (computeRouteMatrix).
 * Server-side only — never expose GOOGLE_MAPS_API_KEY to the client.
 *
 * Returns minutes; null where no route. Coordinates live only in this call's
 * scope: do not log `origins` or the request body.
 *
 * TODO(claude-code): verify current element limits per request for each mode
 * (transit has a lower cap than drive/walk) and chunk if n*m exceeds it.
 * TODO(claude-code): PH transit coverage is weak for jeepney/UV/tricycle —
 * treat TRANSIT results as optimistic until a Sakay-style source is wired in.
 */
export async function travelMinutes(
  origins: LatLng[],
  destinations: LatLng[],
  mode: TravelMode = "DRIVE",
  departureTime?: Date,
): Promise<CostMatrix> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY not set");

  const wp = (p: LatLng) => ({
    waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
  });

  const body: Record<string, unknown> = {
    origins: origins.map(wp),
    destinations: destinations.map(wp),
    travelMode: mode,
  };
  if (mode === "DRIVE") body.routingPreference = "TRAFFIC_AWARE";
  if (departureTime) body.departureTime = departureTime.toISOString();

  const res = await fetch(
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`Routes API ${res.status}`); // no body echo: may contain coords

  const rows: Array<{
    originIndex?: number;
    destinationIndex?: number;
    duration?: string; // e.g. "1234s"
    condition?: string;
  }> = await res.json();

  const m: CostMatrix = origins.map(() => destinations.map(() => null));
  for (const r of rows) {
    const i = r.originIndex ?? 0; // proto3 omits zero values
    const j = r.destinationIndex ?? 0;
    if (r.condition === "ROUTE_EXISTS" && r.duration) {
      m[i][j] = parseInt(r.duration, 10) / 60;
    }
  }
  return m;
}
