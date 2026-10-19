import { test } from "node:test";
import assert from "node:assert/strict";
import { gridRingUnsafe } from "h3-js";
import { accessTimes, buildRail, combineRail, itinerary, lookupWalks, MAX_ACCESS_MIN, railNetwork, railPath, railProvider, railWalks, RIDE_WAIT, type RailNet } from "./rail.ts";
import { loadVenueSnapshot } from "./candidates.ts";
import { haversineKm } from "./scoring.ts";
import { estimateProvider, noteOf, withNote } from "./routing.ts";
import { cellCenter, snapToCell } from "./h3.ts";
import { meet } from "./meet.ts";

// A toy network: line A runs west to east over three stops, line B leaves A's middle stop.
const C0 = "89694ec2bd7ffff"; // Cubao station
const ring = (k: number) => gridRingUnsafe(C0, k);
const net: RailNet = {
  lines: [
    { id: "A", endToEndMin: 20, headwayMin: 6, stations: [{ name: "a1", cell: C0 }, { name: "a2", cell: ring(5)[0] }, { name: "a3", cell: ring(10)[0] }] },
    { id: "B", endToEndMin: 10, headwayMin: 10, stations: [{ name: "b1", cell: ring(5)[0] }, { name: "b2", cell: ring(10)[3] }] },
  ],
  transfers: [{ a: ["A", "a2"], b: ["B", "b1"], walkMin: 4 }],
};

test("run times add up to each line's end-to-end minutes", () => {
  const { stops, ride } = buildRail(net);
  assert.equal(stops.length, 5);
  assert.ok(Math.abs(ride[0][2] - 20) < 1e-9, `a1 to a3 is ${ride[0][2]}`);
  assert.ok(Math.abs(ride[2][0] - 20) < 1e-9);
});

test("a transfer costs the walk plus half the next line's wait (no entry time in the toy network)", () => {
  const { ride } = buildRail(net);
  const a1ToA2 = ride[0][1];
  // a1 → a2, walk 4 min to b1, wait 5 min (B every 10), ride B's whole 10 min.
  assert.ok(Math.abs(ride[0][4] - (a1ToA2 + 4 + 5 + 10)) < 1e-9, `got ${ride[0][4]}`);
});

test("each member gets the faster of walking and the train, with access walks capped", () => {
  const { stops, ride } = buildRail(net);
  // One member, two venues. Venue 0 is a short walk; venue 1 is far, near a3.
  const walkOV = [[8, 90]];
  const walkOB = [[5]]; // 5 min to a1
  const walkAV = [[60, 3]]; // from a3: 60 min to venue 0, 3 min to venue 1
  const out = combineRail(walkOV, walkOB, walkAV, [0], [2], stops, ride);
  assert.equal(out[0][0], 8); // walking wins
  assert.ok(Math.abs(out[0][1]! - (5 + 3 + 20 + 3)) < 1e-9, `got ${out[0][1]}`); // walk, wait 3 (A every 6), ride 20, walk
  // Too far to walk to the station: the train isn't an option.
  const { access } = accessTimes([[MAX_ACCESS_MIN + 1]], [0], [[]], [], 5);
  const capped = combineRail(walkOV, access, walkAV, [0], [2], stops, ride);
  assert.equal(capped[0][1], 90);
});

test("getting to a station: the faster of walking and a ride plus its wait, each capped", () => {
  // Two members, stops 0 and 2. Walk to stop 0 only; ride to stops 0 and 2.
  const walk = [[10], [45]];
  const drive = [[2, 50], [12, 35]];
  const { board, access } = accessTimes(walk, [0], drive, [0, 2], 5);
  assert.deepEqual(board, [0, 2]);
  assert.deepEqual(access[0], [7, null]); // ride 2+5 beats a 10 min walk; 50+5 is over the 45 min ride cap
  assert.deepEqual(access[1], [17, 40]); // a 45 min walk is over the 30 min walk cap; 35+5 is a ride within its cap
});

/** A snapshot venue within a short walk of Ayala station, with an entry in the station-walk table. */
function venueByAyala() {
  const { stops } = railNetwork();
  const ayala = stops.find((s) => s.name === "Ayala")!;
  const table = railWalks(stops);
  const v = loadVenueSnapshot().find((v) => haversineKm(v.location, ayala.point) < 0.4 && lookupWalks(table, [v.location]).alight.length);
  assert.ok(v, "no venue by Ayala station in data/rail-walks.json");
  return v.location;
}

test("station-to-venue walks come from the table; places not in it (a member's own area) get none", () => {
  const { stops } = railNetwork();
  const table = railWalks(stops);
  const { alight, walkAV } = lookupWalks(table, [venueByAyala(), cellCenter("89694ec2967ffff")]);
  assert.ok(alight.length > 0);
  assert.ok(walkAV.every((row) => row[1] === null)); // a cell centre isn't a venue
  assert.ok(walkAV.some((row) => row[0] != null && row[0] <= MAX_ACCESS_MIN));
});

test("railProvider asks for one walking and one driving matrix, and never returns more than walking", async () => {
  const calls: string[] = [];
  const counting = {
    ...estimateProvider,
    minutes: async (...a: Parameters<typeof estimateProvider.minutes>) => {
      calls.push(`${a[0].length}x${a[1].length}:${a[2]}`);
      return estimateProvider.minutes(...a);
    },
  };
  const origins = [cellCenter("89694ec2967ffff")]; // Katipunan station (LRT-2)
  const venues = [venueByAyala(), cellCenter("89694ec2967ffff")]; // by Ayala station (MRT-3), and the origin itself
  const [walk] = await estimateProvider.minutes(origins, venues, "WALK");
  const [rail] = await railProvider(counting).minutes(origins, venues, "RAIL");
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((c) => c.endsWith(":WALK")).length, 1); // station to venue is a table lookup
  assert.equal(calls.filter((c) => c.endsWith(":DRIVE")).length, 1); // origins to their nearest stations
  assert.ok(rail[0]! < walk[0]!, `Katipunan to Ayala: rail ${rail[0]} vs walk ${walk[0]}`);
  assert.equal(rail[1], walk[1]); // already there: walking (0 min) wins
});

test("a member far from any line rides to a station instead of walking all the way", async () => {
  const fairview = cellCenter(snapToCell({ lat: 14.7353, lng: 121.0598 })); // Fairview Terraces, ~6 km from North Avenue
  const ayala = venueByAyala();
  const [walk] = await estimateProvider.minutes([fairview], [ayala], "WALK");
  const walkOnly = { ...estimateProvider, supports: ["WALK" as const] };
  const [noRide] = await railProvider(walkOnly).minutes([fairview], [ayala], "RAIL");
  const [withRide] = await railProvider(estimateProvider).minutes([fairview], [ayala], "RAIL");
  assert.equal(noRide[0], walk[0]); // too far to walk to a station: no train
  assert.ok(withRide[0]! < walk[0]! / 2, `Fairview to Ayala: ${withRide[0]} with a ride vs ${walk[0]} walking`);
});

test("meet accepts RAIL and ranks with train times", async () => {
  const prev = process.env.ROUTING_PROVIDER;
  process.env.ROUTING_PROVIDER = "estimate";
  try {
    const origins = [
      { memberId: "m1", cell: "89694ec2967ffff" }, // Katipunan
      { memberId: "m2", cell: "89694ec1dcbffff" }, // Ayala
    ];
    const { status, body } = await meet({ origins, mode: "RAIL" });
    assert.equal(status, 200, JSON.stringify(body));
    assert.match(String(body.source), /^live:rail\+/);
    assert.ok((body.results as unknown[]).length > 0);
  } finally {
    if (prev === undefined) delete process.env.ROUTING_PROVIDER;
    else process.env.ROUTING_PROVIDER = prev;
  }
});

test("a walking provider's note (e.g. the foot-hiking fallback) stays on train times", async () => {
  const noted = {
    ...estimateProvider,
    minutes: async (...a: Parameters<typeof estimateProvider.minutes>) => withNote(await estimateProvider.minutes(...a), "walk:foot-hiking"),
  };
  const m = await railProvider(noted).minutes([cellCenter("89694ec2967ffff")], [venueByAyala()], "RAIL");
  assert.equal(noteOf(m), "walk:foot-hiking");
});

test("if driving fails, the search goes on with walks to stations only, and says so", async () => {
  const failingDrive = {
    ...estimateProvider,
    minutes: async (...a: Parameters<typeof estimateProvider.minutes>) => {
      if (a[2] === "DRIVE") throw new Error("ORS 503");
      return estimateProvider.minutes(...a);
    },
  };
  const fairview = cellCenter(snapToCell({ lat: 14.7353, lng: 121.0598 }));
  const ayala = venueByAyala();
  const [walk] = await estimateProvider.minutes([fairview], [ayala], "WALK");
  const m = await railProvider(failingDrive).minutes([fairview], [ayala], "RAIL");
  assert.equal(m[0][0], walk[0]); // Fairview is too far to walk to a station, so without a ride it's walking
  assert.equal(noteOf(m), "rail:no-rides");
});

test("a driving request that hangs is given up after RIDE_WAIT, not the full provider timeout", async () => {
  const hanging = {
    ...estimateProvider,
    minutes: (...a: Parameters<typeof estimateProvider.minutes>) =>
      a[2] === "DRIVE" ? new Promise<never>(() => {}) : estimateProvider.minutes(...a),
  };
  const saved = RIDE_WAIT.ms;
  RIDE_WAIT.ms = 30;
  try {
    const t = Date.now();
    const m = await railProvider(hanging).minutes([cellCenter("89694ec2967ffff")], [venueByAyala()], "RAIL");
    assert.ok(Date.now() - t < 2000);
    assert.equal(noteOf(m), "rail:no-rides");
  } finally {
    RIDE_WAIT.ms = saved;
  }
});

test("an itinerary names the stations and lines, and its minutes add up to the trip", async () => {
  const origin = cellCenter("89694ec2967ffff"); // Katipunan (LRT-2)
  const m = await railProvider(estimateProvider).minutes([origin], [venueByAyala()], "RAIL");
  const legs = itinerary(m, 0, 0)!;
  assert.ok(legs, "no itinerary");
  const trains = legs.filter((l) => l.kind === "train");
  assert.deepEqual(trains.map((l) => l.kind === "train" && l.line), ["LRT-2", "MRT-3"]);
  assert.ok(legs.some((l) => l.kind === "transfer"), "LRT-2 to MRT-3 needs a transfer");
  assert.equal(legs.at(-1)!.kind, "walk");
  const sum = legs.reduce((s, l) => s + l.min, 0);
  assert.ok(Math.abs(sum - m[0][0]!) < 1e-6, `legs add to ${sum}, trip is ${m[0][0]}`);
});

test("itineraries only for the single-phone planner, never by default (group links)", async () => {
  const prev = process.env.ROUTING_PROVIDER;
  process.env.ROUTING_PROVIDER = "estimate";
  try {
    const origins = [
      { memberId: "m1", cell: "89694ec2967ffff" },
      { memberId: "m2", cell: "89694ec1dcbffff" },
    ];
    const plain = await meet({ origins, mode: "RAIL" });
    const results = (r: typeof plain) => r.body.results as { perMember: { trip?: unknown }[] }[];
    assert.ok(results(plain).every((r) => r.perMember.every((p) => p.trip === undefined)));
    const single = await meet({ origins, mode: "RAIL" }, { itineraries: true });
    assert.ok(results(single).every((r) => r.perMember.every((p) => Array.isArray(p.trip))));
    const drive = await meet({ origins, mode: "DRIVE" }, { itineraries: true });
    assert.ok(results(drive).every((r) => r.perMember.every((p) => p.trip === undefined)));
  } finally {
    if (prev === undefined) delete process.env.ROUTING_PROVIDER;
    else process.env.ROUTING_PROVIDER = prev;
  }
});

test("railPath follows the next-hop table end to end", () => {
  const { next } = buildRail(net);
  assert.deepEqual(railPath(next, 0, 4), [0, 1, 3, 4]); // a1, a2, then over to b1 and on to b2
});

test("a trip has to ride a train: boarding and leaving at the same station, or only crossing a walkway, doesn't count", () => {
  const { usesTrain } = buildRail(net);
  assert.equal(usesTrain[0][0], false); // same stop
  assert.equal(usesTrain[1][3], false); // a2 to b1 is the transfer walk alone
  assert.equal(usesTrain[0][1], true);
  assert.equal(usesTrain[0][4], true);
  const { stops, ride } = buildRail(net);
  // Getting to a1 is 5 min and the venue is 3 min from a1: without the rule that "train trip" (5 + wait + 0 + 3) beat a 20 min walk.
  const out = combineRail([[20]], [[5]], [[3]], [0], [0], stops, ride, usesTrain);
  assert.equal(out[0][0], 20);
});
