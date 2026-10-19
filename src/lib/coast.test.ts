import { test } from "node:test";
import assert from "node:assert/strict";
import { clipToLand, shoreOf, stitch, type Pt } from "./coast.ts";

// A coastline running north along longitude 1: land is on its left, the west.
const coast: Pt[][] = [[[1, -1], [1, 3]]];
const square: Pt[] = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];

test("the sea half of a ring is replaced by the coastline", () => {
  const { ring, seaVertices } = clipToLand(square, coast);
  assert.equal(seaVertices, 2);
  assert.deepEqual(ring, [[0, 0], [1, 0], [1, 2], [0, 2], [0, 0]]);
});

test("a ring entirely on land comes back unchanged", () => {
  const inland: Pt[] = [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0]];
  assert.deepEqual(clipToLand(inland, coast).ring, inland);
});

test("a bend in the coast is kept, in order", () => {
  const bent: Pt[][] = [[[1, -1], [1, 0.5], [1.5, 1], [1, 1.5], [1, 3]]];
  const { ring } = clipToLand(square, bent);
  assert.deepEqual(ring, [[0, 0], [1, 0], [1, 0.5], [1.5, 1], [1, 1.5], [1, 2], [0, 2], [0, 0]]);
});

test("ways that share end nodes are joined into one chain", () => {
  const ways = [
    { nodes: [3, 4], geometry: [{ lat: 2, lon: 1 }, { lat: 3, lon: 1 }] },
    { nodes: [1, 2, 3], geometry: [{ lat: -1, lon: 1 }, { lat: 0, lon: 1 }, { lat: 2, lon: 1 }] },
  ];
  assert.deepEqual(stitch(ways), [[[1, -1], [1, 0], [1, 2], [1, 3]]]);
});

test("a lake inside the ring is cut out along its near shore", () => {
  // A lake from x 1.5 to 3, y 0.5 to 1.5, drawn counterclockwise as OSM water often is.
  const lake = shoreOf([[1.5, 0.5], [3, 0.5], [3, 1.5], [1.5, 1.5], [1.5, 0.5]]);
  const ring: Pt[] = [[0, 0], [2, 0], [2, 1], [2, 2], [0, 2], [0, 0]]; // (2, 1) is in the lake
  const { ring: clipped, seaVertices } = clipToLand(ring, [lake]);
  assert.equal(seaVertices, 1);
  assert.deepEqual(clipped, [[0, 0], [2, 0], [2, 0.5], [1.5, 0.5], [1.5, 1.5], [2, 1.5], [2, 2], [0, 2], [0, 0]]);
});

test("round a lake, the shorter way is measured by length, not by how many points are mapped", () => {
  // The near (west) shore is short but densely mapped; the far side is three times longer with only two corners.
  const west = [1.5, 1.4, 1.3, 1.2, 1.1, 1, 0.9, 0.8, 0.7, 0.6].map((y) => [1.5, y] as Pt);
  const lake = shoreOf([[1.5, 0.5], [3, 0.5], [3, 1.5], ...west, [1.5, 0.5]]);
  const ring: Pt[] = [[0, 0], [2, 0], [2, 1], [2, 2], [0, 2], [0, 0]];
  const { ring: clipped } = clipToLand(ring, [lake]);
  assert.ok(clipped.every(([x]) => x <= 2), "the outline went round the far side of the lake");
  assert.equal(clipped.length, 9 + 9); // the 9 extra mapped points on the west shore are kept
});

test("a ring entirely in the water is an error, not an empty outline", () => {
  assert.throws(() => clipToLand([[2, 0], [2.5, 0], [2.5, 1], [2, 0]], coast), /whole ring/);
});
