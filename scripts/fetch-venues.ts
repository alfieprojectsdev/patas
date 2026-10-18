/**
 * Rebuild data/mm-venues.json: every named candidate venue inside Metro
 * Manila, from one Overpass query. Run monthly-ish, not per request. Run
 * fetch-landmarks.ts first: each venue stores the name of its nearest
 * landmark, so usual-spot search doesn't have to work it out at runtime.
 *
 *   node --experimental-strip-types scripts/fetch-venues.ts [--out data/mm-venues.json]
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { OVERPASS_FILTERS, overpassToVenues } from "../src/lib/candidates.ts";
import { AREA_BBOX, venueInScope } from "../src/lib/scope.ts";
import { overpassFetchInParts, snapshotJson } from "./overpass.ts";
import { nearbyLandmarks, type LandmarkSnapshot } from "../src/lib/landmarks.ts";
import { snapToCell } from "../src/lib/h3.ts";

const { values } = parseArgs({ options: { out: { type: "string", default: "data/mm-venues.json" } } });

const landmarks = (JSON.parse(readFileSync("data/mm-landmarks.json", "utf8")) as LandmarkSnapshot).landmarks;
const b = AREA_BBOX;
const json = await overpassFetchInParts(
  (bbox) => `[out:json][timeout:170][bbox:${bbox}];
(
${OVERPASS_FILTERS.map((f) => `  ${f};`).join("\n")}
);
out center tags;`,
  b,
  "venue snapshot",
  { rows: 3, cols: 2 },
);

const venues = overpassToVenues(json)
  .filter((v) => venueInScope(v.location))
  .map((v) => ({ ...v, location: { lat: +v.location.lat.toFixed(6), lng: +v.location.lng.toFixed(6) } }))
  .map((v) => {
    const near = nearbyLandmarks(landmarks, snapToCell(v.location), 1)[0]?.name;
    return near ? { ...v, near } : v;
  })
  .sort((x, y) => x.venueId.localeCompare(y.venueId));

const counts: Record<string, number> = {};
for (const v of venues) counts[v.tags[0]] = (counts[v.tags[0]] ?? 0) + 1;

writeFileSync(values.out!, snapshotJson(json.host, json.osm3s?.timestamp_osm_base, "venues", venues));
console.log(`wrote ${values.out}: ${venues.length} venues inside Metro Manila`, counts);
