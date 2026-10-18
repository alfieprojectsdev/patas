import { test } from "node:test";
import assert from "node:assert/strict";
import { kmToRing, originInScope, pointInRing, venueInScope } from "./scope.ts";

test("venues across Metro Manila are in scope, from Navotas to Alabang", () => {
  for (const p of [
    { lat: 14.6537, lng: 121.0687 }, // UP Diliman, Quezon City
    { lat: 14.5547, lng: 121.0244 }, // Makati CBD
    { lat: 14.5197, lng: 121.0153 }, // NAIA Terminal 3, Pasay
    { lat: 14.4237, lng: 121.0423 }, // Alabang, Muntinlupa
    { lat: 14.6505, lng: 120.9478 }, // Navotas fish port
  ]) {
    assert.ok(venueInScope(p));
    assert.ok(originInScope(p));
  }
});

test("just outside Metro Manila: origin allowed by the buffer, venue rejected", () => {
  for (const p of [
    { lat: 14.5786, lng: 121.1222 }, // Cainta, Rizal
    { lat: 14.459, lng: 120.96 }, // Bacoor, Cavite
    { lat: 14.7346, lng: 120.9572 }, // Meycauayan, Bulacan
  ]) {
    assert.equal(venueInScope(p), false);
    assert.ok(originInScope(p));
  }
});

test("far outside: origin rejected even with the buffer", () => {
  for (const p of [
    { lat: 14.62, lng: 121.25 }, // upland Antipolo, ~13 km out
    { lat: 14.211, lng: 121.1653 }, // Calamba
  ]) {
    assert.equal(originInScope(p), false);
  }
});

test("ring helpers on a unit square", () => {
  const sq: [number, number][] = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]];
  assert.ok(pointInRing({ lat: 0.05, lng: 0.05 }, sq));
  assert.equal(pointInRing({ lat: 0.05, lng: 0.15 }, sq), false);
  // 0.05° of longitude east of the edge at the equator ≈ 5.57 km
  assert.ok(Math.abs(kmToRing({ lat: 0.05, lng: 0.15 }, sq) - 5.566) < 0.01);
});
