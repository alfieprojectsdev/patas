import { test } from "node:test";
import assert from "node:assert/strict";
import { rankVenues } from "./scoring.ts";
import type { Venue } from "./types.ts";

const v = (id: string): Venue => ({ venueId: id, name: id, location: { lat: 0, lng: 0 }, tags: [] });

test("minimax beats lower total", () => {
  // A: total 60 but one member travels 50. B: total 75, worst 30.
  const venues = [v("A"), v("B")];
  const cost = [
    [5, 25],
    [5, 30],
    [50, 20],
  ];
  const r = rankVenues(venues, cost, { tolerance: 0 });
  assert.equal(r[0].venue.venueId, "B");
});

test("tolerance lets spread break near-ties on worst", () => {
  // worst 30 vs 32 (within tol 5) → lower spread wins
  const venues = [v("A"), v("B")];
  const cost = [
    [5, 28],
    [30, 32],
  ];
  const r = rankVenues(venues, cost, { tolerance: 5 });
  assert.equal(r[0].venue.venueId, "B");
});

test("unreachable venue for any member is dropped", () => {
  const r = rankVenues([v("A"), v("B")], [[10, null], [10, 5]]);
  assert.deepEqual(r.map((s) => s.venue.venueId), ["A"]);
});

test("rotation shifts venue toward member with less prior burden", () => {
  // Symmetric venues; member 0 already travelled a lot → pick venue near member 0.
  const venues = [v("near0"), v("near1")];
  const cost = [
    [5, 40],
    [40, 5],
  ];
  const r = rankVenues(venues, cost, { priorBurden: [120, 0], tolerance: 0 });
  assert.equal(r[0].venue.venueId, "near0");
});

test("default tolerance: 2 min longer worst trip loses even with an equal total", () => {
  // From a real ORS run: Andok's worst 18/spread 9, R&B worst 16/spread 7, both total 53.
  const venues = [v("andoks"), v("rnb")];
  const cost = [
    [9, 9],
    [13, 16],
    [18, 14],
    [13, 14],
  ];
  assert.deepEqual(rankVenues(venues, cost).map((s) => s.venue.venueId), ["rnb", "andoks"]);
});

test("within a tier, smaller spread beats smaller total", () => {
  // worst 20 vs 21 (one tier at tol 2); B is more even, A is shorter overall.
  const venues = [v("A"), v("B")];
  const cost = [
    [2, 18],
    [20, 21],
  ];
  assert.deepEqual(rankVenues(venues, cost).map((s) => s.venue.venueId), ["B", "A"]);
});

test("tiers are measured from the best, so the order is consistent", () => {
  // worst 20, 21.5, 23: pairwise-within-2 would chain all three together.
  // Tiers: {20, 21.5}, {23}. C has the best spread but sits in the second tier.
  const venues = [v("A"), v("B"), v("C")];
  const cost = [
    [20, 21.5, 23],
    [10, 20, 23],
  ];
  assert.deepEqual(rankVenues(venues, cost).map((s) => s.venue.venueId), ["B", "A", "C"]);
});

test("ties all the way down are broken by venue id, so results are stable", () => {
  const venues = [v("b"), v("a")];
  const cost = [[10, 10], [10, 10]];
  assert.deepEqual(rankVenues(venues, cost).map((s) => s.venue.venueId), ["a", "b"]);
});
