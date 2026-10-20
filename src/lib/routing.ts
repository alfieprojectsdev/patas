import type { CostMatrix, LatLng, TravelMode } from "./types";
import { haversineKm } from "./scoring.ts";

/**
 * Provider seam. Default is OpenRouteService (OSM data, free tier) for the
 * MVP; Google is a fallback; self-hosted OSRM/Valhalla is the privacy upgrade
 * (coords never leave our server); a Sakay.ph-backed provider is the intended
 * TRANSIT upgrade if a data partnership happens.
 * Select with ROUTING_PROVIDER=ors|osrm|google|estimate (default ors; estimate = no-key dev mode).
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

/**
 * Walking fallback. On 2026-10-18 ORS's foot-walking profile hung on every
 * request, in every city, for most of a day, while every other profile on the
 * same key answered in 0.6 s. foot-hiking walks at the same 5 km/h on the same
 * footpaths; it prefers trails, which Metro Manila barely has. So: try
 * foot-walking for `tryMs`; on a timeout, network error or 5xx, use
 * foot-hiking and skip foot-walking for `downMs`. The matrix carries the note
 * "walk:foot-hiking" (see `noteOf`) so the results can say so.
 */
export const ORS_WALK = { profile: "foot-walking", fallback: "foot-hiking", tryMs: 10_000, downMs: 10 * 60_000 };
let walkDownUntil = 0;
export const resetWalkFallbackForTest = () => (walkDownUntil = 0);

const notes = new WeakMap<CostMatrix, string>();
/** A note a provider attached to a matrix, e.g. "walk:foot-hiking". */
export const noteOf = (m: CostMatrix) => notes.get(m);
export function withNote(m: CostMatrix, note: string | undefined): CostMatrix {
  if (note) notes.set(m, note);
  return m;
}

/** Worth trying another profile: the service didn't answer, not "your request is wrong". */
const unanswered = (e: unknown) => {
  const err = e as Error;
  return err?.name === "TimeoutError" || err?.name === "AbortError" || (err?.name === "TypeError" && /fetch failed/i.test(err.message)) || /^ORS 5\d\d$/.test(err?.message ?? "");
};

async function orsMatrix(profile: string, origins: LatLng[], destinations: LatLng[], timeoutMs: number): Promise<CostMatrix> {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error("ORS_API_KEY not set");
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
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ORS ${res.status}`); // no body echo
  return parseOrsMatrix(await res.json(), n, m);
}

export const orsProvider: MatrixProvider = {
  name: "openrouteservice",
  supports: ["DRIVE", "WALK"],
  async minutes(origins, destinations, mode) {
    const profile = ORS_PROFILE[mode];
    if (!profile) throw new Error(`ORS does not support mode ${mode}`);
    if (mode !== "WALK") return orsMatrix(profile, origins, destinations, 20_000);
    if (Date.now() >= walkDownUntil) {
      try {
        return await orsMatrix(ORS_WALK.profile, origins, destinations, ORS_WALK.tryMs);
      } catch (e) {
        if (!unanswered(e)) throw e;
        walkDownUntil = Date.now() + ORS_WALK.downMs;
        const why = (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message;
        console.error(`openrouteservice ${ORS_WALK.profile} failed (${why}); using ${ORS_WALK.fallback} for ${ORS_WALK.downMs / 60_000} min`);
      }
    }
    return withNote(await orsMatrix(ORS_WALK.fallback, origins, destinations, 15_000), `walk:${ORS_WALK.fallback}`);
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

// ---------- OSRM (self-hosted) ----------

/**
 * OSRM's table service on a server we run: on a laptop for precompute
 * (docs/osrm.md), later on a small server for live searches. No quota, and
 * the coordinates never leave our machines. Free-flow times, like ORS.
 *
 * osrm-routed serves one profile per process, so each mode has its own base
 * URL: OSRM_DRIVE_URL (car.lua) and OSRM_WALK_URL (foot.lua). A mode without
 * a URL isn't supported. Start osrm-routed with --max-table-size at least as
 * large as origins + destinations per request (precompute's chunks).
 *
 * GET /table/v1/{profile}/{lng,lat;...}?sources=…&destinations=…&annotations=duration
 * → { code: "Ok", durations: seconds[][] }, null where there's no route.
 */
const OSRM_URL: Partial<Record<TravelMode, string>> = { DRIVE: "OSRM_DRIVE_URL", WALK: "OSRM_WALK_URL" };
const OSRM_PROFILE: Partial<Record<TravelMode, string>> = { DRIVE: "driving", WALK: "foot" };

/** Pure: an OSRM table response → minutes. Errors carry OSRM's code only, never the body. */
export function parseOsrmTable(json: { code?: string; durations?: (number | null)[][] }, n: number, m: number): CostMatrix {
  if (json.code !== "Ok") throw new Error(`OSRM ${json.code ?? "error"}`);
  return parseOrsMatrix(json, n, m); // same shape: seconds, n × m, null for no route
}

export const osrmProvider: MatrixProvider = {
  name: "osrm",
  get supports() {
    return (Object.keys(OSRM_URL) as TravelMode[]).filter((m) => process.env[OSRM_URL[m]!]);
  },
  async minutes(origins, destinations, mode) {
    const base = process.env[OSRM_URL[mode] ?? ""];
    if (!base) throw new Error(`OSRM has no server for mode ${mode}`);
    const n = origins.length;
    const m = destinations.length;
    const coords = [...origins, ...destinations].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const sources = [...Array(n).keys()].join(";");
    const dests = [...Array(m).keys()].map((j) => n + j).join(";");
    const url = `${base.replace(/\/$/, "")}/table/v1/${OSRM_PROFILE[mode]}/${coords}?sources=${sources}&destinations=${dests}&annotations=duration`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(Number(process.env.OSRM_TIMEOUT_MS ?? 60_000)) });
    // A refused request (too many points, bad coordinate) still answers with JSON naming the code.
    const json = (await res.json().catch(() => ({}))) as { code?: string; durations?: (number | null)[][] };
    if (!res.ok && json.code === undefined) throw new Error(`OSRM ${res.status}`);
    return parseOsrmTable(json, n, m);
  },
};

export function getProvider(): MatrixProvider {
  switch (process.env.ROUTING_PROVIDER) {
    case "google": return googleProvider;
    case "osrm": return osrmProvider;
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
