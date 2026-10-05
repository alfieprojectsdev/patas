import { test } from "node:test";
import assert from "node:assert/strict";
import { kmToRing, originInScope, pointInRing, venueInScope } from "./scope.ts";

test("UP Diliman, Novaliches, Cubao are in scope", () => {
  assert.ok(venueInScope({ lat: 14.6537, lng: 121.0687 }));
  assert.ok(venueInScope({ lat: 14.72, lng: 121.04 }));
  assert.ok(venueInScope({ lat: 14.6203, lng: 121.0533 }));
});

test("Makati venue rejected; NAIA origin rejected even with buffer", () => {
  assert.equal(venueInScope({ lat: 14.5547, lng: 121.0244 }), false);
  assert.equal(originInScope({ lat: 14.51, lng: 121.02 }), false);
});

test("inside the bbox but outside QC: venue rejected, origin allowed (polygon, not bbox)", () => {
  for (const p of [
    { lat: 14.6316, lng: 121.0838 }, // Marikina Riverbanks
    { lat: 14.6019, lng: 121.049 }, // Greenhills, San Juan
    { lat: 14.6096, lng: 120.9894 }, // UST, Manila
  ]) {
    assert.equal(venueInScope(p), false);
    assert.ok(originInScope(p));
  }
});

test("origin just north of QC allowed by buffer, venue not", () => {
  const p = { lat: 14.79, lng: 121.06 };
  assert.ok(originInScope(p));
  assert.equal(venueInScope(p), false);
});

test("ring helpers on a unit square", () => {
  const sq: [number, number][] = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]];
  assert.ok(pointInRing({ lat: 0.05, lng: 0.05 }, sq));
  assert.equal(pointInRing({ lat: 0.05, lng: 0.15 }, sq), false);
  // 0.05° of longitude east of the edge at the equator ≈ 5.57 km
  assert.ok(Math.abs(kmToRing({ lat: 0.05, lng: 0.15 }, sq) - 5.566) < 0.01);
});
