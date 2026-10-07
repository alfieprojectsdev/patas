import { test } from "node:test";
import assert from "node:assert/strict";
import { gridRingUnsafe } from "h3-js";
import { indexLandmarks, NEAR_RINGS, nearbyLandmarks, normalize, searchLandmarks, type Landmark } from "./landmarks.ts";
import { estimateMatrix, orsProvider } from "./routing.ts";

const L = (name: string, kind: Landmark["kind"], aka?: string[]): Landmark => ({ name, kind, area: "Quezon City", cell: "89694ec74dbffff", aka });
const idx = indexLandmarks([
  L("SM City North Edsa", "mall"),
  L("SM City Caloocan", "mall", ["SM North Caloocan"]),
  L("Katipunan station (LRT)", "station", ["LRT Katipunan"]),
  L("Bulwagang Pambarangay ng Katipunan", "barangay_hall"),
  L("Santo Niño Parish", "church"),
]);
const names = (q: string) => searchLandmarks(idx, q).map((l) => l.name);

test("normalize strips accents and punctuation", () => {
  assert.equal(normalize("Santo Niño Parish!"), "santo nino parish");
});

test("word-prefix match; a name match outranks an alias-only match", () => {
  assert.deepEqual(names("sm nor"), ["SM City North Edsa", "SM City Caloocan"]);
});

test("stations rank above other kinds; alias finds the line", () => {
  assert.deepEqual(names("katipunan"), ["Katipunan station (LRT)", "Bulwagang Pambarangay ng Katipunan"]);
  assert.deepEqual(names("lrt kat"), ["Katipunan station (LRT)"]);
});

test("accent-insensitive; 1-char queries return nothing", () => {
  assert.deepEqual(names("santo nino"), ["Santo Niño Parish"]);
  assert.deepEqual(names("s"), []);
});

test("estimate: straight line × detour at a flat speed; no transit", () => {
  const a = { lat: 14.65, lng: 121.0 };
  const b = { lat: 14.65, lng: 121.1 }; // ≈ 10.76 km
  const walk = estimateMatrix([a], [b], "WALK")[0][0]!;
  assert.ok(Math.abs(walk - (10.76 * 1.35 * 60) / 4.5) < 1);
  assert.throws(() => estimateMatrix([a], [b], "TRANSIT"));
  assert.throws(() => estimateMatrix([a], [b], "TWO_WHEELER"));
});

test("openrouteservice offers car and walking only, never car times labelled as motorcycle", () => {
  assert.deepEqual(orsProvider.supports, ["DRIVE", "WALK"]);
});

test("nearby: nearest cells first, kind breaks ties, nothing past the ring limit", () => {
  const origin = "89694ec74dbffff";
  const at = (k: number) => gridRingUnsafe(origin, k)[0];
  const P = (name: string, kind: Landmark["kind"], cell: string): Landmark => ({ name, kind, area: "Quezon City", cell });
  const list = [
    P("Far Mall", "mall", at(NEAR_RINGS + 2)),
    P("Ring 3 Mall", "mall", at(3)),
    P("Barangay Hall", "barangay_hall", origin),
    P("Same Cell Station", "station", origin),
    P("Ring 1 School", "school", at(1)),
  ];
  const near = nearbyLandmarks(list, origin);
  assert.deepEqual(near.map((l) => l.name), ["Same Cell Station", "Barangay Hall", "Ring 1 School", "Ring 3 Mall"]);
  assert.equal(near[0].metres, 0);
  assert.ok(near[2].metres > 250 && near[2].metres < 400, `ring 1 is ~300 m, got ${near[2].metres}`);
  assert.deepEqual(nearbyLandmarks(list, origin, 2).map((l) => l.name), ["Same Cell Station", "Barangay Hall"]);
});
