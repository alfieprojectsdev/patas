/**
 * Cut a Metro Manila basemap (zooms 0-15, ~39 MB) from the latest Protomaps
 * daily OSM build into public/tiles/metro-manila.pmtiles. Only the needed
 * byte ranges are downloaded.
 *
 *   npm run fetch:tiles
 *
 * Needs the `pmtiles` CLI (github.com/protomaps/go-pmtiles/releases) on PATH,
 * or PMTILES_BIN pointing at it. Map data © OpenStreetMap contributors, ODbL.
 *
 * On Vercel (VERCEL=1, via the `vercel-build` script) it downloads the
 * pinned Linux CLI, checks its SHA-256 and runs it there, so a deploy uploads
 * ~3 MB instead of the 39 MB map file. Added after five uploads from a flaky
 * office connection failed at 0 bytes.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PMTILES_VERSION = "1.31.2";
// From the GitHub release's asset digest for go-pmtiles_1.31.2_Linux_x86_64.tar.gz.
const LINUX_SHA256 = "3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f";

async function pmtilesBin(): Promise<string> {
  if (process.env.PMTILES_BIN) return process.env.PMTILES_BIN;
  if (!process.env.VERCEL) return "pmtiles";
  const name = `go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz`;
  const url = `https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`pmtiles download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sum = createHash("sha256").update(buf).digest("hex");
  if (sum !== LINUX_SHA256) throw new Error(`pmtiles checksum mismatch: ${sum}`);
  const dir = join(tmpdir(), "pmtiles");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), buf);
  execFileSync("tar", ["-xzf", name], { cwd: dir, stdio: "inherit" });
  return join(dir, "pmtiles");
}

const BBOX = "120.93,14.54,121.19,14.83"; // QC + origin buffer; keep in sync with TILE_BOUNDS in src/app/map.tsx
const OUT = "public/tiles/metro-manila.pmtiles";

const res = await fetch("https://build-metadata.protomaps.dev/builds.json", { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`builds.json ${res.status}`);
const builds = (await res.json()) as { key: string }[];
const latest = builds.at(-1)!.key;
console.log(`extracting from ${latest}`);

mkdirSync("public/tiles", { recursive: true });
if (existsSync(OUT) && !process.env.VERCEL) console.log(`${OUT} exists; overwriting`);
execFileSync(
  await pmtilesBin(),
  ["extract", `https://build.protomaps.com/${latest}`, OUT, `--bbox=${BBOX}`, "--maxzoom=15"],
  { stdio: "inherit" },
);
