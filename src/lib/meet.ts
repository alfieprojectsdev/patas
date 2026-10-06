import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findCandidates } from "./candidates.ts";
import { getProvider } from "./routing.ts";
import { rankVenues } from "./scoring.ts";
import { originInScope } from "./scope.ts";
import { cellCenter, isValidOriginCell } from "./h3.ts";
import { bandFor, covers, lookup, type PrecomputedTable } from "./precomputed.ts";
import type { CostMatrix, Origin, TravelMode, Venue } from "./types";

/**
 * The ranking pipeline behind /api/meet and /api/groups/[id]/meet.
 *
 * Takes H3 cells only; from here on, only cell centres are used, and exact
 * coordinates go nowhere, not even to the routing provider.
 *
 * Path selection:
 *  1. Precomputed table for (mode, band) in PRECOMPUTED_DIR → pure lookup.
 *  2. Otherwise live provider + candidate search.
 *
 * PRIVACY: don't log inputs; don't return members' cells (host options come
 * back with location null).
 */
export type MeetInput = {
  origins: { memberId: string; cell: string }[];
  mode: TravelMode;
  priorBurden?: number[];
  departureTime?: string;
};
export type MeetOutcome = { status: number; body: Record<string, unknown> };

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

export async function meet({ origins: input, mode, priorBurden, departureTime }: MeetInput): Promise<MeetOutcome> {
  const cells = input.map((o) => o.cell);
  if (!cells.every((c) => isValidOriginCell(c))) return { status: 400, body: { error: "invalid cell" } };
  const origins: Origin[] = input.map((o, i) => ({ memberId: o.memberId, landmark: cellCenter(cells[i]) }));

  // Generic message: don't reveal which member is out of area.
  if (!origins.every((o) => originInScope(o.landmark))) {
    return { status: 422, body: { error: "Patas currently covers Quezon City only" } };
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
        return { status: 400, body: { error: `mode ${mode} not supported by ${provider.name}` } };
      }
      venues = await findCandidates(origins);
      matrix = await provider.minutes(origins.map((o) => o.landmark), venues.map((v) => v.location), mode, departureTime ? depart : undefined);
      source = `live:${provider.name}`;
    }
  } catch (e) {
    console.error("meet failed:", (e as Error).message); // message only, no payload
    return { status: 502, body: { error: "upstream failure" } };
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
  return { status: 200, body: { results, source } };
}
