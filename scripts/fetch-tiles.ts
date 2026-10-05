/**
 * Cut a Metro Manila basemap (zooms 0-15, ~39 MB) from the latest Protomaps
 * daily OSM build into public/tiles/metro-manila.pmtiles. Only the needed
 * byte ranges are downloaded.
 *
 *   npm run fetch:tiles
 *
 * Needs the `pmtiles` CLI (github.com/protomaps/go-pmtiles/releases) on PATH,
 * or PMTILES_BIN pointing at it. Map data © OpenStreetMap contributors, ODbL.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const BBOX = "120.93,14.54,121.19,14.83"; // QC + origin buffer; keep in sync with TILE_BOUNDS in src/app/map.tsx
const OUT = "public/tiles/metro-manila.pmtiles";

const res = await fetch("https://build-metadata.protomaps.dev/builds.json", { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`builds.json ${res.status}`);
const builds = (await res.json()) as { key: string }[];
const latest = builds.at(-1)!.key;
console.log(`extracting from ${latest}`);

mkdirSync("public/tiles", { recursive: true });
execFileSync(
  process.env.PMTILES_BIN ?? "pmtiles",
  ["extract", `https://build.protomaps.com/${latest}`, OUT, `--bbox=${BBOX}`, "--maxzoom=15"],
  { stdio: "inherit" },
);
