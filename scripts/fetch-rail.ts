/**
 * Build data/rail.json for the "Train + walking" mode: the hand-maintained
 * lines in data/rail-lines.json plus each station's position from
 * OpenStreetMap, stored as an H3 res-9 cell like every other place in Patas.
 *
 *   node --experimental-strip-types scripts/fetch-rail.ts
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { overpassFetchInParts } from "./overpass.ts";
import { snapToCell } from "../src/lib/h3.ts";
import { haversineKm } from "../src/lib/scoring.ts";
import { normalize } from "../src/lib/landmarks.ts";
import type { LatLng } from "../src/lib/types";

type LinesFile = {
  entryMin: number;
  entryNote: string;
  lines: { id: string; endToEndMin: number; headwayMin: number; sources: string[]; stations: string[] }[];
  transfers: { a: [string, string]; b: [string, string]; walkMin: number; source: string }[];
};
const spec = JSON.parse(readFileSync("data/rail-lines.json", "utf8")) as LinesFile;

const json = await overpassFetchInParts(
  (bbox) => `[out:json][timeout:120][bbox:${bbox}];
(
  nwr["railway"~"^(station|halt)$"]["name"];
  nwr["public_transport"="station"]["name"];
);
out center tags;`,
  { south: 14.3, west: 120.88, north: 14.83, east: 121.25 },
  "rail stations",
  { rows: 1, cols: 1, rounds: 6 },
);

type Cand = { name: string; key: string; p: LatLng; tags: Record<string, string> };
// "Araneta Center–Cubao station (LRT)" and "Araneta Center-Cubao" should compare equal.
const keyOf = (s: string) => normalize(s.replace(/\(.*?\)/g, "").replace(/\bstation\b/gi, ""));
const cands: Cand[] = json.elements.flatMap((el) => {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const t = el.tags ?? {};
  return lat == null || lng == null || !t.name ? [] : [{ name: t.name, key: keyOf(t.name), p: { lat, lng }, tags: t }];
});

/** Rules out stations of other lines that share a name: PNR's Vito Cruz and EDSA, MRT-7's Quirino. */
function wrongLine(c: Cand, line: string): boolean {
  const s = `${c.tags.network ?? ""} ${c.tags.operator ?? ""} ${c.tags.line ?? ""} ${c.tags.name ?? ""}`;
  if (/PNR|Philippine National Railways/i.test(s)) return true;
  if (/MRT[- ]?7|Line 7/i.test(s)) return true;
  if (line === "MRT-3" && /LRT|Light Rail Transit Authority|LRMC/i.test(s)) return true;
  if (line !== "MRT-3" && /MRT[- ]?3|Metro Rail Transit/i.test(s)) return true;
  return false;
}

// A station may list other names OSM uses, after "|": "Araneta Center-Cubao|Cubao".
const problems: string[] = [];
const out = spec.lines.map((line) => {
  let prev: LatLng | null = null;
  const stations = line.stations.map((entry) => {
    const [name, ...alts] = entry.split("|");
    const keys = new Set([name, ...alts].map(keyOf));
    const matches = cands.filter((c) => keys.has(c.key) && !wrongLine(c, line.id));
    if (!matches.length) {
      problems.push(`${line.id}: no OSM station named ${entry}`);
      return { name, cell: "" };
    }
    // Several left (node and way, or platforms): take the one nearest the previous station.
    const pick: Cand = prev ? matches.reduce((a, b) => (haversineKm(b.p, prev!) < haversineKm(a.p, prev!) ? b : a)) : matches[0];
    if (prev && haversineKm(pick.p, prev) > 4) problems.push(`${line.id}: ${name} is ${haversineKm(pick.p, prev).toFixed(1)} km from the previous station`);
    prev = pick.p;
    return { name, cell: snapToCell(pick.p) };
  });
  return { id: line.id, endToEndMin: line.endToEndMin, headwayMin: line.headwayMin, sources: line.sources, stations };
});

if (problems.length) {
  for (const k of ["cubao", "vito", "edsa", "santolan", "ortigas", "shaw", "quirino"]) {
    console.log(k, cands.filter((c) => c.key.includes(k)).map((c) => `${c.name} [${c.tags.network ?? c.tags.operator ?? "-"}]`).join("; "));
  }
  throw new Error(problems.join("\n"));
}

writeFileSync(
  "data/rail.json",
  JSON.stringify(
    {
      source: `Lines: data/rail-lines.json. Station positions: OpenStreetMap via ${json.host}, © OpenStreetMap contributors, ODbL 1.0.`,
      builtAt: new Date().toISOString(),
      entryMin: spec.entryMin,
      entryNote: spec.entryNote,
      lines: out,
      transfers: spec.transfers,
    },
    null,
    1,
  ),
);
console.log(`wrote data/rail.json: ${out.map((l) => `${l.id} ${l.stations.length} stations`).join(", ")}`);
