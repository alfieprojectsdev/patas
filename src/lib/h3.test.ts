import { test } from "node:test";
import assert from "node:assert/strict";
import { snapToCell, cellCenter, isValidOriginCell, serviceAreaCells, H3_RES } from "./h3.ts";
import { haversineKm } from "./scoring.ts";
import { lookup, bandFor, type PrecomputedTable } from "./precomputed.ts";

const upd = { lat: 14.6537, lng: 121.0687 };

test("snap error at res 9 stays under ~250 m", () => {
  const c = snapToCell(upd);
  assert.ok(isValidOriginCell(c));
  assert.ok(haversineKm(upd, cellCenter(c)) < 0.25);
});

test("wrong resolution rejected", () => {
  assert.equal(isValidOriginCell(snapToCell(upd, 7)), false);
  assert.equal(isValidOriginCell("not-a-cell"), false);
});

test("service-area cells include UP Diliman's cell", () => {
  const cells = new Set(serviceAreaCells(H3_RES));
  assert.ok(cells.has(snapToCell(upd)));
  assert.ok(cells.size > 1000 && cells.size < 5000);
});

test("lookup returns rows per origin; unknown cell → nulls", () => {
  const a = snapToCell(upd);
  const t: PrecomputedTable = {
    version: 1, res: 9, mode: "DRIVE", band: "weekday_dismissal", provider: "test", builtAt: "",
    venues: [
      { venueId: "v1", name: "v1", location: upd, tags: [] },
      { venueId: "v2", name: "v2", location: upd, tags: [] },
    ],
    cells: [a],
    minutes: [[12, null]],
  };
  assert.deepEqual(lookup(t, [a, "89694ed5a5bffff"]), [[12, null], [null, null]]);
});

test("time bands in Manila time", () => {
  assert.equal(bandFor(new Date("2026-10-07T08:30:00Z")), "weekday_dismissal"); // Wed 16:30 PHT
  assert.equal(bandFor(new Date("2026-10-07T11:00:00Z")), "weekday_evening"); // Wed 19:00 PHT
  assert.equal(bandFor(new Date("2026-10-10T06:00:00Z")), "weekend_afternoon"); // Sat
});
