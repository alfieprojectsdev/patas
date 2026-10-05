import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeByCell, overpassToVenues, parseOverpass, pickCandidates, overpassQuery, type OverpassEl } from "./candidates.ts";
import type { Venue } from "./types";
import { parseOrsMatrix } from "./routing.ts";

const area = { lat: 14.6537, lng: 121.0687, radiusM: 3000 }; // ~UP Diliman

test("overpass: nodes and way centers parsed, unnamed dropped, nearest first", () => {
  const json: { elements: OverpassEl[] } = {
    elements: [
      { type: "way" as const, id: 2, center: { lat: 14.70, lon: 121.07 }, tags: { name: "Far Mall", shop: "mall" } },
      { type: "node" as const, id: 1, lat: 14.654, lon: 121.069, tags: { name: "Near Cafe", amenity: "cafe", internet_access: "wlan" } },
      { type: "node" as const, id: 3, lat: 14.655, lon: 121.07, tags: { amenity: "cafe" } }, // no name
    ],
  };
  const v = parseOverpass(json, area, 10);
  assert.deepEqual(v.map((x) => x.name), ["Near Cafe", "Far Mall"]);
  assert.equal(v[0].venueId, "osm:node/1");
  assert.ok(v[0].tags.includes("wifi:wlan"));
  assert.ok(v[1].tags.includes("shop:mall"));
});

test("overpass: duplicates (same name, ~same spot) collapse; cap respected", () => {
  const el = (id: number) => ({ type: "node" as const, id, lat: 14.6541, lon: 121.0691, tags: { name: "Dup", amenity: "cafe" } });
  assert.equal(parseOverpass({ elements: [el(1), el(2)] }, area, 10).length, 1);
  const many = Array.from({ length: 30 }, (_, i) => ({
    type: "node" as const, id: i, lat: 14.65 + i * 0.001, lon: 121.07, tags: { name: `V${i}`, amenity: "cafe" },
  }));
  assert.equal(parseOverpass({ elements: many }, area, 5).length, 5);
});

test("overpass query embeds radius and coords", () => {
  const q = overpassQuery(area, 20);
  assert.match(q, /around:3000,14\.653700,121\.068700/);
  assert.match(q, /shop"="mall/);
});

test("ORS matrix: seconds → minutes, null preserved, shape checked", () => {
  const m = parseOrsMatrix({ durations: [[600, null], [120, 1800]] }, 2, 2);
  assert.deepEqual(m, [[10, null], [2, 30]]);
  assert.throws(() => parseOrsMatrix({ durations: [[1]] }, 2, 2));
});

test("overpass: staff canteens and access=private dropped; amenity wins over shop tag", () => {
  const v = overpassToVenues({
    elements: [
      { type: "node", id: 1, lat: 14.65, lon: 121.07, tags: { name: "EAMC Coop Canteen", amenity: "fast_food" } },
      { type: "node", id: 2, lat: 14.65, lon: 121.07, tags: { name: "Club Cafe", amenity: "cafe", access: "private" } },
      { type: "node", id: 3, lat: 14.65, lon: 121.07, tags: { name: "Bakeshop", amenity: "cafe", shop: "bakery" } },
    ],
  });
  assert.deepEqual(v.map((x) => [x.name, x.tags[0]]), [["Bakeshop", "cafe"]]);
});

const venue = (venueId: string, lat: number, lng: number, cat: string): Venue => ({ venueId, name: venueId, location: { lat, lng }, tags: [cat] });

test("dedupeByCell keeps the best category per H3 cell", () => {
  const v = dedupeByCell([
    venue("jollibee", 14.6566, 121.0291, "fast_food"),
    venue("sm-north", 14.65661, 121.02911, "shop:mall"),
    venue("far-cafe", 14.70, 121.05, "cafe"),
  ]);
  assert.deepEqual(v.map((x) => x.venueId).sort(), ["far-cafe", "sm-north"]);
});

test("pickCandidates: minimax distance first, and picks kept apart", () => {
  const origins = [
    { memberId: "a", landmark: { lat: 14.65, lng: 121.00 } },
    { memberId: "b", landmark: { lat: 14.65, lng: 121.10 } },
  ];
  const pool = [
    venue("near-a", 14.65, 121.01, "cafe"), // close to a, far from b
    venue("mid", 14.65, 121.05, "cafe"),
    venue("mid-twin", 14.65, 121.051, "cafe"), // ~110 m from mid
    venue("mid-ish", 14.65, 121.06, "cafe"),
  ];
  const ids = (xs: Venue[]) => xs.map((x) => x.venueId);
  assert.deepEqual(ids(pickCandidates(pool, origins, 2)), ["mid", "mid-ish"]);
  assert.deepEqual(ids(pickCandidates(pool, origins, 2, 0)), ["mid", "mid-twin"]);
});
