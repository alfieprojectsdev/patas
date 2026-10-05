/**
 * Rebuild data/qc-venues.json: every named candidate venue inside the QC
 * boundary, from one Overpass query. Run monthly-ish, not per request.
 *
 *   node --experimental-strip-types scripts/fetch-venues.ts [--out data/qc-venues.json]
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { OVERPASS_FILTERS, overpassToVenues } from "../src/lib/candidates.ts";
import { QC_BBOX, venueInScope } from "../src/lib/scope.ts";
import { overpassFetch, snapshotJson } from "./overpass.ts";

const { values } = parseArgs({ options: { out: { type: "string", default: "data/qc-venues.json" } } });

const b = QC_BBOX;
const json = await overpassFetch(
  `[out:json][timeout:170][bbox:${b.south},${b.west},${b.north},${b.east}];
(
${OVERPASS_FILTERS.map((f) => `  ${f};`).join("\n")}
);
out center tags;`,
  "venue snapshot",
);

const venues = overpassToVenues(json)
  .filter((v) => venueInScope(v.location))
  .map((v) => ({ ...v, location: { lat: +v.location.lat.toFixed(6), lng: +v.location.lng.toFixed(6) } }))
  .sort((x, y) => x.venueId.localeCompare(y.venueId));

const counts: Record<string, number> = {};
for (const v of venues) counts[v.tags[0]] = (counts[v.tags[0]] ?? 0) + 1;

writeFileSync(values.out!, snapshotJson(json.host, json.osm3s?.timestamp_osm_base, "venues", venues));
console.log(`wrote ${values.out}: ${venues.length} venues inside QC`, counts);
