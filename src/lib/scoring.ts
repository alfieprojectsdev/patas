import type { CostMatrix, Venue, VenueScore } from "./types";

/**
 * Fair-venue ranking. Pure function, no I/O — this is the part to unit test.
 *
 * Objective (lexicographic, with tolerance):
 *   1. minimize the worst-off member's burden          (minimax)
 *   2. then minimize spread (max - min) this meeting   (equity)
 *   3. then minimize total cost                        (efficiency)
 *
 * Rotation: pass `priorBurden[i]` = member i's cumulative cost from past
 * meetings. Objective 1 then minimizes max(prior + current), which naturally
 * sends the venue toward whoever has travelled least so far.
 *
 * `tolerance` treats objective values within that margin as ties, so a
 * 1-minute minimax difference doesn't override a large spread/total gain.
 */
export function rankVenues(
  venues: Venue[],
  cost: CostMatrix,
  opts: { priorBurden?: number[]; tolerance?: number } = {},
): VenueScore[] {
  const n = cost.length;
  const prior = opts.priorBurden ?? new Array(n).fill(0);
  const tol = opts.tolerance ?? 5;

  if (prior.length !== n) throw new Error("priorBurden length != members");

  const scored: VenueScore[] = [];
  venues.forEach((venue, j) => {
    const perMember: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = cost[i]?.[j];
      if (c == null || !Number.isFinite(c)) return; // unreachable for someone → drop venue
      perMember.push(c);
    }
    const withPrior = perMember.map((c, i) => c + prior[i]);
    scored.push({
      venue,
      worst: Math.max(...withPrior),
      spread: Math.max(...perMember) - Math.min(...perMember),
      total: perMember.reduce((a, b) => a + b, 0),
      perMember,
    });
  });

  const cmp = (a: number, b: number) => (Math.abs(a - b) <= tol ? 0 : a - b);
  return scored.sort(
    (a, b) =>
      cmp(a.worst, b.worst) || cmp(a.spread, b.spread) || a.total - b.total,
  );
}

/** Mean of points — used ONLY as a search seed for candidate venues, never as the answer. */
export function centroid(pts: { lat: number; lng: number }[]) {
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return { lat, lng };
}

/** Haversine km — for sizing the candidate search radius. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
