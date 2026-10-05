import { NextResponse } from "next/server";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findCandidates } from "@/lib/candidates";
import { getProvider } from "@/lib/routing";
import { rankVenues } from "@/lib/scoring";
import { originInScope } from "@/lib/scope";
import { cellCenter, isValidOriginCell, snapToCell } from "@/lib/h3";
import { bandFor, covers, lookup, type PrecomputedTable } from "@/lib/precomputed";
import type { CostMatrix, Origin, Venue } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/meet
 * Body: { origins: [{memberId, cell} | {memberId, landmark:{lat,lng}}], mode?, priorBurden?, departureTime? }
 *
 * Preferred: client snaps to an H3 res-9 cell and sends only `cell`.
 * `landmark` is accepted for convenience but is snapped immediately; from
 * here on, only cell centres are used — exact coords go nowhere, not even to
 * the routing provider.
 *
 * Path selection:
 *  1. Precomputed table for (mode, band) in PRECOMPUTED_DIR → pure lookup.
 *  2. Otherwise live provider + candidate search.
 *
 * PRIVACY: don't log requests; don't persist cells or coords; don't return
 * other members' cells. Persist only aliases + minutes (rotation).
 */
const LatLngZ = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const OriginZ = z.union([
  z.object({ memberId: z.string().min(1).max(32), cell: z.string().min(15).max(16) }),
  z.object({ memberId: z.string().min(1).max(32), landmark: LatLngZ }),
]);
const Body = z.object({
  origins: z.array(OriginZ).min(2).max(10),
  mode: z.enum(["DRIVE", "WALK", "TRANSIT", "TWO_WHEELER"]).default("DRIVE"),
  priorBurden: z.array(z.number().nonnegative()).optional(),
  departureTime: z.string().datetime({ offset: true }).optional(),
});

const tableCache = new Map<string, PrecomputedTable | null>();
function loadTable(mode: string, band: string): PrecomputedTable | null {
  const dir = process.env.PRECOMPUTED_DIR;
  if (!dir) return null;
  const key = `${mode.toLowerCase()}_${band}`;
  if (!tableCache.has(key)) {
    const f = join(dir, `${key}.json`);
    tableCache.set(key, existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as PrecomputedTable) : null);
  }
  return tableCache.get(key)!;
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { mode, priorBurden, departureTime } = parsed.data;

  // Normalise to cells; drop raw coordinates.
  const cells = parsed.data.origins.map((o) => ("cell" in o ? o.cell : snapToCell(o.landmark)));
  if (!cells.every((c) => isValidOriginCell(c))) {
    return NextResponse.json({ error: "invalid cell" }, { status: 400 });
  }
  const origins: Origin[] = parsed.data.origins.map((o, i) => ({
    memberId: o.memberId,
    landmark: cellCenter(cells[i]),
  }));

  // Generic message: don't reveal which member is out of area.
  if (!origins.every((o) => originInScope(o.landmark))) {
    return NextResponse.json({ error: "Patas currently covers Quezon City only" }, { status: 422 });
  }

  const depart = departureTime ? new Date(departureTime) : new Date();
  // Tables cover cells inside QC only; a buffer-zone member forces live routing.
  const loaded = loadTable(mode, bandFor(depart));
  const table = loaded && covers(loaded, cells) ? loaded : null;

  let venues: Venue[];
  let matrix: CostMatrix;
  let source: string;
  try {
    if (table) {
      // TODO(claude-code): host options need a cell→cell table; public venues only for now.
      venues = table.venues;
      matrix = lookup(table, cells);
      source = `precomputed:${table.provider}:${table.builtAt.slice(0, 10)}`;
    } else {
      const provider = getProvider();
      if (!provider.supports.includes(mode)) {
        return NextResponse.json({ error: `mode ${mode} not supported by ${provider.name}` }, { status: 400 });
      }
      venues = await findCandidates(origins);
      matrix = await provider.minutes(origins.map((o) => o.landmark), venues.map((v) => v.location), mode, departureTime ? depart : undefined);
      source = `live:${provider.name}`;
    }
  } catch (e) {
    console.error("meet failed:", (e as Error).message); // message only, no payload
    return NextResponse.json({ error: "upstream failure" }, { status: 502 });
  }

  const ranked = rankVenues(venues, matrix, { priorBurden }).slice(0, 5);
  const results = ranked.map((s) => ({
    venueId: s.venue.venueId,
    name: s.venue.name,
    location: s.venue.tags.includes("host") ? null : s.venue.location, // never expose a member's cell
    tags: s.venue.tags,
    worst: Math.round(s.worst),
    spread: Math.round(s.spread),
    total: Math.round(s.total),
    perMember: origins.map((o, i) => ({ memberId: o.memberId, minutes: Math.round(s.perMember[i]) })),
  }));
  return NextResponse.json({ results, source });
}
