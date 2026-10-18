import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { noteOf, orsProvider, ORS_WALK, resetWalkFallbackForTest } from "./routing.ts";

// A stand-in for openrouteservice: foot-walking never answers (until aborted), everything else does.
const realFetch = globalThis.fetch;
let asked: string[] = [];
const a = { lat: 14.6195, lng: 121.0525 };
const b = { lat: 14.5491, lng: 121.028 };

beforeEach(() => {
  asked = [];
  resetWalkFallbackForTest();
  ORS_WALK.tryMs = 50;
  process.env.ORS_API_KEY = "test";
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const profile = String(url).split("/").at(-1)!;
    asked.push(profile);
    if (profile === "foot-walking") {
      return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    }
    return new Response(JSON.stringify({ durations: [[600]] }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  ORS_WALK.tryMs = 10_000;
});

test("walking falls back to foot-hiking when foot-walking doesn't answer, and says so", async () => {
  const m = await orsProvider.minutes([a], [b], "WALK");
  assert.deepEqual(m, [[10]]);
  assert.deepEqual(asked, ["foot-walking", "foot-hiking"]);
  assert.equal(noteOf(m), "walk:foot-hiking");
});

test("after one failure, foot-walking is skipped for a while", async () => {
  await orsProvider.minutes([a], [b], "WALK");
  asked = [];
  await orsProvider.minutes([a], [b], "WALK");
  assert.deepEqual(asked, ["foot-hiking"]);
});

test("driving never falls back, and a working foot-walking carries no note", async () => {
  const drive = await orsProvider.minutes([a], [b], "DRIVE");
  assert.equal(noteOf(drive), undefined);
  globalThis.fetch = (async () => new Response(JSON.stringify({ durations: [[300]] }), { status: 200 })) as typeof fetch;
  const walk = await orsProvider.minutes([a], [b], "WALK");
  assert.deepEqual(walk, [[5]]);
  assert.equal(noteOf(walk), undefined);
});

test("a 4xx (bad key, quota) is an error, not a reason to switch profiles", async () => {
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url).split("/").at(-1)!);
    return new Response("{}", { status: 403 });
  }) as typeof fetch;
  await assert.rejects(orsProvider.minutes([a], [b], "WALK"), /ORS 403/);
  assert.deepEqual(asked, ["foot-walking"]);
});
