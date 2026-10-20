import { test } from "node:test";
import assert from "node:assert/strict";
import { findCandidates, isFood, loadFoodSnapshot, loadSnapshot, loadVenueSnapshot } from "./candidates.ts";
import { cellCenter, snapToCell } from "./h3.ts";
import { meet } from "./meet.ts";

const origins = [
  { memberId: "m1", landmark: cellCenter("89694ec2967ffff") }, // Katipunan
  { memberId: "m2", landmark: cellCenter("89694ec1dcbffff") }, // Ayala
];

test("food only: every candidate is a café, restaurant or fast food place, and nobody's own area is offered", async () => {
  const all = await findCandidates(origins);
  const food = await findCandidates(origins, 20, { foodOnly: true });
  assert.ok(all.some((v) => v.tags.includes("host")), "host options are there by default");
  assert.ok(food.length > 0);
  assert.ok(food.every(isFood), food.filter((v) => !isFood(v)).map((v) => v.tags[0]).join(", "));
});

test("food places that share a cell with a mall or library aren't lost", () => {
  const cellOf = (v: { location: { lat: number; lng: number } }) => snapToCell(v.location);
  // Cells where the plain shortlist keeps a non-food venue but a food venue also sits.
  const plain = new Map(loadSnapshot().map((v) => [cellOf(v), v]));
  const shadowed = loadVenueSnapshot().filter((v) => isFood(v) && !isFood(plain.get(cellOf(v)) ?? v));
  assert.ok(shadowed.length > 0, "the snapshot has food places in the same cell as a mall or library");
  const foodCells = new Set(loadFoodSnapshot().map(cellOf));
  assert.ok(shadowed.every((v) => foodCells.has(cellOf(v))));
});

test("meet passes foodOnly through to the ranking", async () => {
  const prev = process.env.ROUTING_PROVIDER;
  process.env.ROUTING_PROVIDER = "estimate";
  try {
    const cells = [{ memberId: "m1", cell: "89694ec2967ffff" }, { memberId: "m2", cell: "89694ec1dcbffff" }];
    const { status, body } = await meet({ origins: cells, mode: "DRIVE", foodOnly: true });
    assert.equal(status, 200);
    const results = body.results as { tags: string[] }[];
    assert.ok(results.length > 0 && results.every((r) => ["cafe", "fast_food", "restaurant"].includes(r.tags[0])));
  } finally {
    if (prev === undefined) delete process.env.ROUTING_PROVIDER;
    else process.env.ROUTING_PROVIDER = prev;
  }
});
