import { test } from "node:test";
import assert from "node:assert/strict";
import { rushHourRange, showsRushHour } from "./traffic.ts";

test("rush-hour range is 1.5x to 2x, rounded", () => {
  assert.deepEqual(rushHourRange(16), [24, 32]);
  assert.deepEqual(rushHourRange(7), [11, 14]);
});

test("range only for clear-road ORS driving times", () => {
  assert.ok(showsRushHour("live:openrouteservice", "DRIVE"));
  assert.equal(showsRushHour("live:openrouteservice", "TWO_WHEELER"), false); // ORS has no motorcycle mode
  assert.ok(showsRushHour("precomputed:openrouteservice:2026-10-07", "DRIVE"));
  assert.equal(showsRushHour("live:openrouteservice", "WALK"), false); // walking isn't slowed by traffic
  assert.equal(showsRushHour("live:google-routes", "DRIVE"), false); // already traffic-aware
  assert.equal(showsRushHour("live:straight-line-estimate", "DRIVE"), false); // fake times
});
