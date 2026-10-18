/**
 * Build data/rail-walks.json: walking minutes from each LRT/MRT stop to every
 * venue in data/mm-venues.json within RADIUS_KM, keeping those within
 * MAX_ACCESS_MIN. Train mode looks the last leg (station to venue) up here
 * instead of asking openrouteservice at search time: one live request for
 * every station near any venue reached pairs 30 km apart and was refused
 * (error 6020, "Search exceeds the limit of visited nodes", 2026-10-18).
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/fetch-rail-walks.ts
 *
 * One request per stop (51), paced under the free plan's 40 matrix requests a
 * minute. Rerun after fetch-rail or fetch-venues. Needs ORS_API_KEY.
 * Times © openrouteservice by HeiGIT (CC-BY-SA 4.0); data © OpenStreetMap contributors.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildRail, MAX_ACCESS_MIN, type RailNet } from "../src/lib/rail.ts";
import { loadVenueSnapshot } from "../src/lib/candidates.ts";
import { noteOf, orsProvider } from "../src/lib/routing.ts";
import { haversineKm } from "../src/lib/scoring.ts";

/** 30 min at 5 km/h is 2.5 km of path; the straight line is never longer. */
const RADIUS_KM = 2.5;
const PAUSE_MS = 1600;

const { stops } = buildRail(JSON.parse(readFileSync("data/rail.json", "utf8")) as RailNet);
const venues = loadVenueSnapshot();
const walks: Record<string, Record<string, number>> = {};
const notes = new Set<string>();
let requests = 0;
let pairs = 0;

for (const s of stops) {
  const near = venues.filter((v) => haversineKm(s.point, v.location) <= RADIUS_KM);
  if (!near.length) continue;
  const matrix = await orsProvider.minutes([s.point], near.map((v) => v.location), "WALK");
  const [row] = matrix;
  notes.add(noteOf(matrix) ?? "walk:foot-walking");
  requests++;
  const kept: Record<string, number> = {};
  row.forEach((m, j) => {
    if (m != null && m <= MAX_ACCESS_MIN) kept[near[j].venueId] = Math.round(m * 10) / 10;
  });
  walks[`${s.line}|${s.name}`] = kept;
  pairs += Object.keys(kept).length;
  console.log(`${s.line} ${s.name}: ${Object.keys(kept).length} of ${near.length} venues within ${MAX_ACCESS_MIN} min`);
  await new Promise((r) => setTimeout(r, PAUSE_MS));
}

// "walk:foot-hiking" means openrouteservice's walking profile was down and its hiking profile stood in.
const profiles = [...notes].map((n) => n.replace("walk:", ""));
writeFileSync(
  "data/rail-walks.json",
  JSON.stringify({
    source: `openrouteservice by HeiGIT (CC-BY-SA 4.0), profile ${profiles.join(" + ")}; data © OpenStreetMap contributors. Stops: data/rail.json. Venues: data/mm-venues.json.`,
    builtAt: new Date().toISOString(),
    profiles,
    maxMin: MAX_ACCESS_MIN,
    walks,
  }),
);
console.log(`wrote data/rail-walks.json: ${pairs} station-venue walks from ${requests} requests (${profiles.join(", ")})`);
