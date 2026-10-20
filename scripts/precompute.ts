/**
 * Build a precomputed cell→venue travel-time table.
 *
 *   node --experimental-strip-types scripts/precompute.ts \
 *     --band weekday_dismissal --mode DRIVE --venues data/venues.json \
 *     --out data/tables/drive_weekday_dismissal.json [--depart 2026-10-07T16:30:00+08:00]
 *
 * Provider comes from ROUTING_PROVIDER (ors|osrm|google). For a laptop build
 * with no quota, run OSRM locally (docs/osrm.md) with ROUTING_PROVIDER=osrm.
 * For a one-off traffic-aware build, use google + --depart on a
 * representative future day. OSRM and ORS are free-flow, so their tables are
 * the same for every band.
 *
 * Cost control: total elements = cells × venues. Check provider quotas
 * BEFORE running (--dry-run prints the count). CHUNK_ORIGINS / CHUNK_DEST
 * set request size (OSRM: keep origins + destinations within the server's
 * --max-table-size), SLEEP_MS throttles between requests (default 1500,
 * 0 for osrm).
 *
 * Resumable: progress goes to <out>.partial.json every SAVE_EVERY blocks
 * (default 20) and when a request fails. Rerun the same command to carry on;
 * the partial file is deleted once the table is written.
 * TODO(claude-code): data/venues.json — curated venue list; schema = Venue[].
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { getProvider } from "../src/lib/routing.ts";
import { serviceAreaCells, H3_RES } from "../src/lib/h3.ts";
import { runPrecompute, type Progress } from "../src/lib/precompute-run.ts";
import type { PrecomputedTable, TimeBand } from "../src/lib/precomputed.ts";
import type { TravelMode, Venue } from "../src/lib/types.ts";

const { values } = parseArgs({
  options: {
    band: { type: "string" },
    mode: { type: "string", default: "DRIVE" },
    venues: { type: "string", default: "data/venues.json" },
    out: { type: "string" },
    depart: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!values.band || !values.out) throw new Error("--band and --out required");

const venues: Venue[] = JSON.parse(readFileSync(values.venues!, "utf8"));
const cells = serviceAreaCells(H3_RES);
const provider = getProvider();
const mode = values.mode as TravelMode;
if (!provider.supports.includes(mode)) throw new Error(`${provider.name} doesn't support ${mode}`);
const depart = values.depart ? new Date(values.depart) : undefined;

const CO = Number(process.env.CHUNK_ORIGINS ?? 25);
const CD = Number(process.env.CHUNK_DEST ?? 25);
const SLEEP = Number(process.env.SLEEP_MS ?? (provider.name === "osrm" ? 0 : 1500));

const total = cells.length * venues.length;
const requests = Math.ceil(cells.length / CO) * Math.ceil(venues.length / CD);
console.log(`${provider.name} ${mode} ${values.band}: ${cells.length} cells × ${venues.length} venues = ${total} elements in ${requests} requests`);
if (values["dry-run"]) process.exit(0);

const partial = `${values.out}.partial.json`;
mkdirSync(dirname(values.out!), { recursive: true });
const minutes = await runPrecompute({
  cells,
  venues,
  mode,
  provider,
  chunkOrigins: CO,
  chunkDest: CD,
  depart,
  sleepMs: SLEEP,
  saveEvery: Number(process.env.SAVE_EVERY ?? 20),
  load: () => (existsSync(partial) ? (JSON.parse(readFileSync(partial, "utf8")) as Progress) : null),
  // Write then rename, so an interrupted save never leaves a half-written file.
  save: (p) => {
    writeFileSync(`${partial}.tmp`, JSON.stringify(p));
    renameSync(`${partial}.tmp`, partial);
  },
  log: (line) => console.log(line),
});

const table: PrecomputedTable = {
  version: 1,
  res: H3_RES,
  mode,
  band: values.band as TimeBand,
  provider: provider.name,
  builtAt: new Date().toISOString(),
  venues,
  cells,
  minutes: minutes.map((r) => r.map((m) => (m == null ? null : Math.round(m * 10) / 10))),
};
writeFileSync(values.out!, JSON.stringify(table));
rmSync(partial, { force: true });
console.log(`wrote ${values.out}`);
