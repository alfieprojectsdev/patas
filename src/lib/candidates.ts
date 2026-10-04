import type { LatLng, Origin, Venue } from "./types";
import { centroid, haversineKm } from "./scoring";

/**
 * Candidate venues: public places near the group, plus each member's
 * landmark as a "host at home/nearby" option.
 *
 * The centroid is only a search SEED. The search radius covers the spread of
 * origins so the fair answer isn't excluded just because it's off-centre.
 *
 * Uses Places API (New) searchNearby. Server-side only.
 * TODO(claude-code): confirm includedTypes values against current Places docs.
 * TODO(claude-code): add a curated allowlist (school, public libraries) per city.
 */
const VENUE_TYPES = ["cafe", "library", "shopping_mall", "restaurant"];

export async function findCandidates(origins: Origin[], max = 20): Promise<Venue[]> {
  const pts = origins.map((o) => o.landmark);
  const seed = centroid(pts);
  const spreadKm = Math.max(...pts.map((p) => haversineKm(seed, p)));
  const radiusM = Math.min(Math.max(spreadKm * 1000 * 0.6, 1500), 50000);

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
      includedTypes: VENUE_TYPES,
      maxResultCount: max,
      locationRestriction: {
        circle: { center: { latitude: seed.lat, longitude: seed.lng }, radius: radiusM },
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

  const publicVenues: Venue[] = (data.places ?? []).map((p) => ({
    venueId: p.id,
    name: p.displayName?.text ?? "Unnamed",
    location: { lat: p.location.latitude, lng: p.location.longitude },
    tags: p.types ?? [],
  }));

  const hostOptions: Venue[] = origins.map((o) => ({
    venueId: `member:${o.memberId}`,
    name: `Near ${o.memberId}'s landmark`,
    location: o.landmark as LatLng,
    tags: ["host"],
  }));

  return [...publicVenues, ...hostOptions];
}
