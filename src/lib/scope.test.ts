import { test } from "node:test";
import assert from "node:assert/strict";
import { originInScope, venueInScope } from "./scope.ts";

test("UP Diliman and Novaliches are in scope", () => {
  assert.ok(venueInScope({ lat: 14.6537, lng: 121.0687 }));
  assert.ok(venueInScope({ lat: 14.72, lng: 121.04 }));
});

test("Makati venue rejected; NAIA origin rejected even with buffer", () => {
  assert.equal(venueInScope({ lat: 14.5547, lng: 121.0244 }), false);
  assert.equal(originInScope({ lat: 14.51, lng: 121.02 }), false);
});

test("origin just outside bbox allowed by buffer, venue not", () => {
  const p = { lat: 14.79, lng: 121.06 }; // ~1 km north of bbox
  assert.ok(originInScope(p));
  assert.equal(venueInScope(p), false);
});
