/**
 * Rebuild data/mm-landmarks.json: named public landmarks members can pick as
 * their starting point, inside Metro Manila plus the origin buffer.
 *
 *   node --experimental-strip-types scripts/fetch-landmarks.ts [--out data/mm-landmarks.json]
 *
 * Stores H3 res-9 cells, not coordinates. Data © OpenStreetMap contributors, ODbL.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ORIGIN_BUFFER_KM, AREA_BBOX, originInScope } from "../src/lib/scope.ts";
import { cityOf } from "./cities.ts";
import { snapToCell } from "../src/lib/h3.ts";
import { haversineKm } from "../src/lib/scoring.ts";
import type { Landmark, LandmarkKind } from "../src/lib/landmarks.ts";
import { overpassFetchInParts, snapshotJson } from "./overpass.ts";

const { values } = parseArgs({ options: { out: { type: "string", default: "data/mm-landmarks.json" } } });

const dLat = ORIGIN_BUFFER_KM / 111.32;
const dLng = ORIGIN_BUFFER_KM / (111.32 * Math.cos((((AREA_BBOX.south + AREA_BBOX.north) / 2) * Math.PI) / 180));
const b = AREA_BBOX;
const json = await overpassFetchInParts(
  (bbox) => `[out:json][timeout:170][bbox:${bbox}];
(
  nwr["railway"="station"]["name"];
  nwr["shop"="mall"]["name"];
  nwr["amenity"~"^(school|college|university|hospital|place_of_worship|townhall|marketplace)$"]["name"];
  nwr["leisure"="park"]["name"];
  node["place"~"^(suburb|neighbourhood|quarter)$"]["name"];
);
out center tags;`,
  { south: b.south - dLat, west: b.west - dLng, north: b.north + dLat, east: b.east + dLng },
  "landmark snapshot",
  { rows: 3, cols: 2 },
);

function kindOf(t: Record<string, string>): LandmarkKind | null {
  if (t.railway === "station") return /Subway/i.test(t.network ?? "") ? null : "station"; // not open yet
  if (t.place) return "area";
  if (t.shop === "mall") return "mall";
  if (t.amenity === "university" || t.amenity === "college") return "university";
  if (t.amenity === "school") return "school";
  if (t.amenity === "hospital") return "hospital";
  if (t.amenity === "place_of_worship") return "church";
  if (t.amenity === "townhall") return "barangay_hall";
  if (t.amenity === "marketplace") return "market";
  if (t.leisure === "park") return "park";
  return null;
}

/** "LRT" etc. from network/operator, so "lrt katipunan" finds the station. */
function railLine(t: Record<string, string>): string | null {
  const s = `${t.network ?? ""} ${t.operator ?? ""}`;
  if (/LRT|Light Rail/i.test(s)) return "LRT";
  if (/MRT|Metro Rail/i.test(s)) return "MRT";
  if (/PNR|Philippine National Railways/i.test(s)) return "PNR";
  return null;
}

// Same name + kind within 1.5 km is one place (e.g. a campus mapped as node and way).
const kept = new Map<string, { lat: number; lng: number }[]>();
const landmarks: Landmark[] = [];
for (const el of json.elements) {
  const t = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const kind = kindOf(t);
  if (lat == null || lng == null || !t.name || !kind) continue;
  const p = { lat, lng };
  if (!originInScope(p)) continue;
  const key = `${kind}|${t.name.toLowerCase()}`;
  const same = kept.get(key) ?? [];
  if (same.some((q) => haversineKm(p, q) < 1.5)) continue;
  kept.set(key, [...same, p]);
  const line = kind === "station" ? railLine(t) : null;
  const name = kind === "station" && !/station/i.test(t.name) ? `${t.name} station${line ? ` (${line})` : ""}` : t.name;
  const aka = [t.short_name, t.alt_name, t.official_name, line && `${line} ${t.name}`]
    .flatMap((s) => (s ? s.split(";") : []))
    .map((s) => s.trim())
    .filter((s): s is string => !!s && s !== t.name);
  landmarks.push({
    name,
    kind,
    // Inside Metro Manila the city outline decides, so names are consistent ("Quezon City", not "QC").
    area: cityOf(p) ?? (t["addr:city"] || t["is_in:city"] || "near Metro Manila"),
    cell: snapToCell(p),
    ...(aka.length ? { aka } : {}),
  });
}
landmarks.sort((x, y) => x.name.localeCompare(y.name) || x.cell.localeCompare(y.cell));

const counts: Record<string, number> = {};
for (const l of landmarks) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
writeFileSync(values.out!, snapshotJson(json.host, json.osm3s?.timestamp_osm_base, "landmarks", landmarks));
console.log(`wrote ${values.out}: ${landmarks.length} landmarks`, counts);
