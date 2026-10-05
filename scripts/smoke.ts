/**
 * Live smoke test against the real providers (unit tests use fixtures only).
 *
 *   node --env-file-if-exists=.env.local --experimental-strip-types scripts/smoke.ts
 *
 * Uses three PUBLIC QC landmarks, never member data. Overpass needs no key;
 * the routing step runs only if the selected provider's key is set.
 * Prints counts and timings, not coordinates.
 */
import { findCandidates } from "../src/lib/candidates.ts";
import { getProvider } from "../src/lib/routing.ts";
import { rankVenues } from "../src/lib/scoring.ts";
import { cellCenter, snapToCell } from "../src/lib/h3.ts";
import type { Origin } from "../src/lib/types.ts";

const LANDMARKS = {
  "UP Diliman Oblation": { lat: 14.6545, lng: 121.0648 },
  "SM City North EDSA": { lat: 14.6566, lng: 121.0291 },
  "Gateway Mall Cubao": { lat: 14.6203, lng: 121.0533 },
};

const origins: Origin[] = Object.values(LANDMARKS).map((p, i) => ({
  memberId: `m${i + 1}`,
  landmark: cellCenter(snapToCell(p)), // same snapping as the API
}));

const t0 = Date.now();
const venues = await findCandidates(origins);
const pub = venues.filter((v) => !v.tags.includes("host"));
console.log(`candidates (${process.env.CANDIDATE_SOURCE ?? "snapshot"}): ${pub.length} public + ${venues.length - pub.length} host in ${Date.now() - t0} ms`);
for (const v of pub.slice(0, 5)) console.log(`  ${v.venueId}  ${v.name}  [${v.tags.join(",")}]`);
if (pub.length === 0) {
  console.error("FAIL: no public venues");
  process.exit(1);
}

const provider = getProvider();
const keyVar = ({ openrouteservice: "ORS_API_KEY", "google-routes": "GOOGLE_MAPS_API_KEY" } as Record<string, string>)[provider.name];
if (keyVar && !process.env[keyVar]) {
  console.log(`routing: skipped (${keyVar} not set)`);
  process.exit(0);
}

const t1 = Date.now();
const matrix = await provider.minutes(origins.map((o) => o.landmark), venues.map((v) => v.location), "DRIVE");
const nulls = matrix.flat().filter((m) => m == null).length;
console.log(`routing (${provider.name}): ${matrix.length}×${venues.length} in ${Date.now() - t1} ms, ${nulls} unreachable`);

const ranked = rankVenues(venues, matrix).slice(0, 3);
for (const s of ranked) {
  console.log(`  ${s.venue.name}: worst ${Math.round(s.worst)} min, spread ${Math.round(s.spread)}, per member ${s.perMember.map(Math.round).join("/")}`);
}
