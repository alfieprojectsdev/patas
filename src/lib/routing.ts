import type { CostMatrix, LatLng, TravelMode } from "./types";

/**
 * Provider seam. Google is the default; a Sakay.ph-backed provider (jeepney/
 * UV/bus routing + fares) is the intended upgrade for TRANSIT if a data
 * partnership happens. Keep scoring/candidates provider-agnostic.
 */
export interface MatrixProvider {
  name: string;
  minutes(origins: LatLng[], destinations: LatLng[], mode: TravelMode, departureTime?: Date): Promise<CostMatrix>;
}

export const googleProvider: MatrixProvider = {
  name: "google-routes",
  minutes: (o, d, m, t) => travelMinutes(o, d, m, t),
};

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
