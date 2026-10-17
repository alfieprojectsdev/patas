import { test } from "node:test";
import assert from "node:assert/strict";
import { gridRingUnsafe } from "h3-js";
import { cellCenter } from "./h3.ts";
import { indexVenues, searchVenues } from "./venues.ts";
import { meet, placeUsual } from "./meet.ts";
import { loadVenueSnapshot } from "./candidates.ts";
import { venueInScope } from "./scope.ts";
import type { Landmark } from "./landmarks.ts";
import type { Venue, VenueScore } from "./types";

const CUBAO = "89694ec2bd7ffff";
const KATIPUNAN = "89694ec2967ffff";
const SM_NORTH = "89694ec2c87ffff";

const L = (name: string, cell: string): Landmark => ({ name, kind: "station", area: "Quezon City", cell });
const V = (venueId: string, name: string, cell: string, tag = "fast_food"): Venue => ({ venueId, name, location: cellCenter(cell), tags: [tag] });

test("venue search tells same-named branches apart by their nearest landmark", () => {
  const landmarks = [L("Cubao station", CUBAO), L("Katipunan station (LRT)", KATIPUNAN)];
  const idx = indexVenues(
    [V("a", "Jollibee", CUBAO), V("b", "Jollibee", KATIPUNAN), V("c", "Jollibee Express", gridRingUnsafe(CUBAO, 1)[0])],
    landmarks,
  );
  const all = searchVenues(idx, "jollibee");
  assert.deepEqual(all.map((h) => h.name), ["Jollibee", "Jollibee", "Jollibee Express"]);
  assert.deepEqual(all.map((h) => h.near).slice(0, 2).sort(), ["Cubao station", "Katipunan station (LRT)"]);
  // The landmark's words narrow it down, but only after name matches.
  assert.deepEqual(searchVenues(idx, "jollibee kat").map((h) => h.venueId), ["b"]);
  assert.equal(searchVenues(idx, "j").length, 0);
});

test("placeUsual reports rank among everything reachable, or null if someone can't get there", () => {
  const s = (venueId: string) => ({ venue: { venueId } }) as VenueScore;
  const ranked = [s("x"), s("y"), s("z")];
  assert.deepEqual(placeUsual(ranked, "z"), { index: 2, of: 3 });
  assert.equal(placeUsual(ranked, "gone"), null);
});

test("meet always ranks the usual spot, even when it isn't in the top five", async () => {
  const prev = process.env.ROUTING_PROVIDER;
  process.env.ROUTING_PROVIDER = "estimate";
  try {
    const origins = [
      { memberId: "m1", cell: SM_NORTH },
      { memberId: "m2", cell: KATIPUNAN },
      { memberId: "m3", cell: CUBAO },
    ];
    // The northernmost venue in the snapshot, far from everyone, so it can't make the top five.
    // Picked at run time so a snapshot rebuild can't break the test.
    const usual = loadVenueSnapshot()
      .filter((v) => venueInScope(v.location))
      .reduce((a, b) => (b.location.lat > a.location.lat ? b : a)).venueId;
    const { status, body } = await meet({ origins, mode: "WALK", usual });
    assert.equal(status, 200);
    const u = body.usual as { venueId: string; rank: number; of: number; worst: number; perMember: unknown[] };
    assert.equal(u.venueId, usual);
    assert.ok(u.rank > 5 && u.rank <= u.of, `rank ${u.rank} of ${u.of}`);
    assert.equal(u.perMember.length, 3);
    assert.ok((body.results as { venueId: string }[]).every((r) => r.venueId !== usual));

    const bad = await meet({ origins, mode: "WALK", usual: "osm:node/0" });
    assert.equal(bad.status, 400);
    const none = await meet({ origins, mode: "WALK" });
    assert.equal("usual" in none.body, false);
  } finally {
    if (prev === undefined) delete process.env.ROUTING_PROVIDER;
    else process.env.ROUTING_PROVIDER = prev;
  }
});
