/**
 * Build a precomputed cell→venue travel-time table.
 *
 *   node --experimental-strip-types scripts/precompute.ts \
 *     --band weekday_dismissal --mode DRIVE --venues data/venues.json \
 *     --out data/tables/drive_weekday_dismissal.json [--depart 2026-10-07T16:30:00+08:00]
 *
 * Provider comes from ROUTING_PROVIDER (ors|google). For a one-off
 * traffic-aware build, use google + --depart on a representative future day.
 *
 * Cost control: total elements = cells × venues. Check provider quotas
 * BEFORE running; CHUNK_ORIGINS / CHUNK_DEST env set request size and
 * SLEEP_MS throttles between requests.
 * TODO(claude-code): resumable runs (write partial progress every N chunks).
 * TODO(claude-code): data/venues.json — curated QC list; schema = Venue[].
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { getProvider } from "../src/lib/routing.ts";
import { cellCenter, serviceAreaCells, H3_RES } from "../src/lib/h3.ts";
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
const depart = values.depart ? new Date(values.depart) : undefined;

const CO = Number(process.env.CHUNK_ORIGINS ?? 25);
const CD = Number(process.env.CHUNK_DEST ?? 25);
const SLEEP = Number(process.env.SLEEP_MS ?? 1500);

const total = cells.length * venues.length;
const requests = Math.ceil(cells.length / CO) * Math.ceil(venues.length / CD);
console.log(`${provider.name} ${mode} ${values.band}: ${cells.length} cells × ${venues.length} venues = ${total} elements in ${requests} requests`);
if (values["dry-run"]) process.exit(0);

const minutes: (number | null)[][] = cells.map(() => venues.map(() => null));
const destPts = venues.map((v) => v.location);
let done = 0;

for (let i0 = 0; i0 < cells.length; i0 += CO) {
  const oCells = cells.slice(i0, i0 + CO);
  const oPts = oCells.map(cellCenter);
  for (let j0 = 0; j0 < venues.length; j0 += CD) {
    const block = await provider.minutes(oPts, destPts.slice(j0, j0 + CD), mode, depart);
    block.forEach((row, di) => row.forEach((m, dj) => (minutes[i0 + di][j0 + dj] = m)));
    done++;
    if (done % 20 === 0) console.log(`${done}/${requests}`);
    await new Promise((r) => setTimeout(r, SLEEP));
  }
}

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
mkdirSync(dirname(values.out!), { recursive: true });
writeFileSync(values.out!, JSON.stringify(table));
console.log(`wrote ${values.out}`);
