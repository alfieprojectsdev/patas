import { test } from "node:test";
import assert from "node:assert/strict";
import { gridRingUnsafe } from "h3-js";
import { accessTimes, buildRail, combineRail, MAX_ACCESS_MIN, railProvider, type RailNet } from "./rail.ts";
import { estimateProvider } from "./routing.ts";
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

test("railProvider asks for two walking matrices and one driving matrix, and never returns more than walking", async () => {
  const calls: string[] = [];
  const counting = {
    ...estimateProvider,
    minutes: async (...a: Parameters<typeof estimateProvider.minutes>) => {
      calls.push(`${a[0].length}x${a[1].length}:${a[2]}`);
      return estimateProvider.minutes(...a);
    },
  };
  const origins = [cellCenter("89694ec2967ffff")]; // Katipunan station (LRT-2)
  const venues = [cellCenter("89694ec1dcbffff"), cellCenter("89694ec2967ffff")]; // Ayala (MRT-3), and the origin itself
  const [walk] = await estimateProvider.minutes(origins, venues, "WALK");
  const [rail] = await railProvider(counting).minutes(origins, venues, "RAIL");
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((c) => c.endsWith(":WALK")).length, 2);
  assert.equal(calls.filter((c) => c.endsWith(":DRIVE")).length, 1); // origins to their nearest stations
  assert.ok(rail[0]! < walk[0]!, `Katipunan to Ayala: rail ${rail[0]} vs walk ${walk[0]}`);
  assert.equal(rail[1], walk[1]); // already there: walking (0 min) wins
});

test("a member far from any line rides to a station instead of walking all the way", async () => {
  const fairview = cellCenter(snapToCell({ lat: 14.7353, lng: 121.0598 })); // Fairview Terraces, ~6 km from North Avenue
  const ayala = cellCenter("89694ec1dcbffff");
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
