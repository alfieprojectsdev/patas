import type { CostMatrix, Venue, VenueScore } from "./types";

/**
 * Fair-venue ranking. Pure function, no I/O — this is the part to unit test.
 *
 * Objective (lexicographic):
 *   1. minimize the worst-off member's burden          (minimax)
 *   2. then minimize spread (max - min) this meeting   (equity)
 *   3. then minimize total cost                        (efficiency)
 *
 * Rotation: pass `priorBurden[i]` = member i's cumulative cost from past
 * meetings. Objective 1 then minimizes max(prior + current), which naturally
 * sends the venue toward whoever has travelled least so far.
 *
 * Near-ties on objective 1: venues are grouped into tiers. The first tier is
 * every venue whose worst is within `tolerance` minutes of the best worst;
 * the next tier starts from the best of the rest, and so on. Tiers come in
 * order; inside a tier, spread (to the whole minute) decides, then total.
 * Measuring from each tier's best keeps the order consistent, unlike a
 * pairwise "within tolerance" check (A≈B and B≈C but A<C).
 *
 * Default tolerance 2 min ≈ the error from snapping landmarks to H3 res-9
 * cells, so it only absorbs differences the input can't resolve. It was 5,
 * which let a venue with a 2-minute-longer worst trip win on total alone.
 */
export const DEFAULT_TOLERANCE = 2;

export function rankVenues(
  venues: Venue[],
  cost: CostMatrix,
  opts: { priorBurden?: number[]; tolerance?: number } = {},
): VenueScore[] {
  const n = cost.length;
  const prior = opts.priorBurden ?? new Array(n).fill(0);
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;

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

  // Assign tiers by worst: each tier spans [its best worst, + tol].
  const byWorst = [...scored].sort((a, b) => a.worst - b.worst);
  const tier = new Map<VenueScore, number>();
  let t = -1;
  let floor = -Infinity;
  for (const s of byWorst) {
    if (s.worst > floor + tol) {
      t++;
      floor = s.worst;
    }
    tier.set(s, t);
  }
  return byWorst.sort(
    (a, b) =>
      tier.get(a)! - tier.get(b)! ||
      Math.round(a.spread) - Math.round(b.spread) ||
      a.total - b.total ||
      a.worst - b.worst ||
      a.venue.venueId.localeCompare(b.venue.venueId),
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
