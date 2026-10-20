import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runPrecompute, type Progress } from "./precompute-run.ts";
import { estimateProvider, osrmProvider, parseOsrmTable, type MatrixProvider } from "./routing.ts";
import type { Venue } from "./types";

const cells = ["89694ec2967ffff", "89694ec1dcbffff", "89694ec74dbffff"];
const venue = (id: string, lat: number, lng: number): Venue => ({ venueId: id, name: id, location: { lat, lng }, tags: ["cafe"] });
const venues = [venue("v1", 14.62, 121.05), venue("v2", 14.55, 121.03)];

/** Counts requests, and fails once on the given request number. */
function flaky(failOn: number | null) {
  let calls = 0;
  const provider: MatrixProvider = {
    ...estimateProvider,
    minutes: async (...a) => {
      calls++;
      if (calls === failOn) throw new Error("ORS 503");
      return estimateProvider.minutes(...a);
    },
  };
  return { provider, calls: () => calls };
}

test("a failed request keeps the finished blocks, and the rerun only asks for the rest", async () => {
  let saved: Progress | null = null;
  const store = { load: () => saved, save: (p: Progress) => void (saved = structuredClone(p)) };
  const base = { cells, venues, mode: "DRIVE" as const, chunkOrigins: 1, chunkDest: 1, saveEvery: 100 };

  const first = flaky(4); // 3 cells × 2 venues = 6 blocks; the 4th request fails
  await assert.rejects(runPrecompute({ ...base, provider: first.provider, ...store }), /ORS 503/);
  assert.equal(saved!.done.length, 3);

  const second = flaky(null);
  const minutes = await runPrecompute({ ...base, provider: second.provider, ...store });
  assert.equal(second.calls(), 3); // only the three blocks still missing
  const inOneGo = await runPrecompute({ ...base, provider: flaky(null).provider, load: () => null, save: () => {} });
  assert.deepEqual(minutes, inOneGo); // resuming gives the same table as never failing
});

test("saved progress from different inputs is ignored, not mixed in", async () => {
  let saved: Progress | null = null;
  const store = { load: () => saved, save: (p: Progress) => void (saved = structuredClone(p)) };
  await runPrecompute({ cells, venues, mode: "DRIVE", provider: estimateProvider, chunkOrigins: 1, chunkDest: 1, ...store });
  const run = flaky(null);
  const lines: string[] = [];
  await runPrecompute({ cells, venues: venues.slice(0, 1), mode: "DRIVE", provider: run.provider, chunkOrigins: 1, chunkDest: 1, ...store, log: (l) => lines.push(l) });
  assert.equal(run.calls(), 3);
  assert.ok(lines.some((l) => /different inputs/.test(l)));
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OSRM_DRIVE_URL;
  delete process.env.OSRM_WALK_URL;
});

test("OSRM: one table request per call, seconds to minutes, a mode without a server isn't offered", async () => {
  process.env.OSRM_DRIVE_URL = "http://localhost:5000/";
  assert.deepEqual(osrmProvider.supports, ["DRIVE"]);
  let asked = "";
  globalThis.fetch = (async (url: string) => {
    asked = String(url);
    return new Response(JSON.stringify({ code: "Ok", durations: [[600, null]] }), { status: 200 });
  }) as typeof fetch;
  const m = await osrmProvider.minutes([{ lat: 14.6195, lng: 121.0525 }], [{ lat: 14.5491, lng: 121.028 }, { lat: 14.6, lng: 121 }], "DRIVE");
  assert.deepEqual(m, [[10, null]]);
  assert.match(asked, /^http:\/\/localhost:5000\/table\/v1\/driving\/121\.052500,14\.619500;121\.028000,14\.549100;121\.000000,14\.600000\?sources=0&destinations=1;2&annotations=duration$/);
  await assert.rejects(osrmProvider.minutes([], [], "WALK"), /no server for mode WALK/);
});

test("OSRM: a refusal reports its code, never the response body", async () => {
  process.env.OSRM_DRIVE_URL = "http://localhost:5000";
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: "TooBig", message: "Too many table coordinates" }), { status: 400 })) as typeof fetch;
  await assert.rejects(osrmProvider.minutes([{ lat: 14.6, lng: 121 }], [{ lat: 14.5, lng: 121 }], "DRIVE"), /^Error: OSRM TooBig$/);
  assert.throws(() => parseOsrmTable({ code: "Ok", durations: [[1]] }, 2, 1), /shape/);
});
