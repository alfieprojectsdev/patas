import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findCandidates, loadSnapshot } from "./candidates.ts";
import { getProvider, noteOf } from "./routing.ts";
import { itinerary, railNetwork, railProvider, stationVenues } from "./rail.ts";
import { rankVenues } from "./scoring.ts";
import { originInScope, venueInScope } from "./scope.ts";
import { venueById } from "./venues.ts";
import { alertFailure, describeFailure, errorKind, type Failure } from "./upstream-alert.ts";
import { cellCenter, isValidOriginCell } from "./h3.ts";
import { bandFor, covers, lookup, type PrecomputedTable } from "./precomputed.ts";
import type { CostMatrix, Origin, TravelMode, Venue, VenueScore } from "./types";

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
  /** "Our usual spot": a venue id from the snapshot, always ranked alongside the picks. */
  usual?: string;
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

/**
 * Pure: where the usual spot landed in the full ranking. Unreachable venues
 * are dropped by rankVenues, so a missing usual spot means someone can't get there.
 */
export function placeUsual(ranked: VenueScore[], usualId: string): { index: number; of: number } | null {
  const index = ranked.findIndex((s) => s.venue.venueId === usualId);
  return index < 0 ? null : { index, of: ranked.length };
}

/**
 * `later` runs work that shouldn't hold up the response (the failure alert).
 * Routes pass Next's `after`; elsewhere (tests, scripts) the task just starts.
 */
/**
 * `itineraries`: in Train mode, add each member's route (stations and lines)
 * to every result. Only the single-phone planner asks for it: there one
 * person entered every landmark, so nothing new is revealed. Group links
 * never do, because a boarding station hints at where someone starts.
 */
export type MeetOptions = { later?: (task: () => Promise<unknown>) => void; itineraries?: boolean };

export async function meet(
  { origins: input, mode, priorBurden, departureTime, usual }: MeetInput,
  { later = (task) => void task(), itineraries = false }: MeetOptions = {},
): Promise<MeetOutcome> {
  const cells = input.map((o) => o.cell);
  if (!cells.every((c) => isValidOriginCell(c))) return { status: 400, body: { error: "invalid cell" } };
  const origins: Origin[] = input.map((o, i) => ({ memberId: o.memberId, landmark: cellCenter(cells[i]) }));

  // Generic message: don't reveal which member is out of area.
  if (!origins.every((o) => originInScope(o.landmark))) {
    return { status: 422, body: { error: "Patas currently covers Metro Manila only" } };
  }

  const usualVenue = usual ? venueById(usual) : undefined;
  if (usual && (!usualVenue || !venueInScope(usualVenue.location))) {
    return { status: 400, body: { error: "That usual spot isn't in Patas's venue list." } };
  }

  const depart = departureTime ? new Date(departureTime) : new Date();
  // Tables cover cells inside the service area only; a buffer-zone member forces live routing.
  const loaded = loadTable(mode, bandFor(depart));
  // A usual spot the table doesn't cover forces live routing too.
  const table =
    loaded && covers(loaded, cells) && (!usualVenue || loaded.venues.some((v) => v.venueId === usualVenue.venueId)) ? loaded : null;

  let venues: Venue[];
  let matrix: CostMatrix;
  let source: string;
  // For the failure log: only names, sizes and times, never cells or coordinates.
  let stage: Failure["stage"] = table ? "table" : "candidates";
  let providerName = table ? table.provider : "";
  let size = "-";
  let started = Date.now();
  try {
    if (table) {
      // TODO(claude-code): host options need a cell→cell table; public venues only for now.
      venues = table.venues;
      matrix = lookup(table, cells);
      source = `precomputed:${table.provider}:${table.builtAt.slice(0, 10)}`;
    } else {
      // Train mode wraps whichever provider is configured, for its walking and driving times.
      const provider = mode === "RAIL" ? railProvider(getProvider()) : getProvider();
      providerName = provider.name;
      if (!provider.supports.includes(mode)) {
        return { status: 400, body: { error: `mode ${mode} not supported by ${provider.name}` } };
      }
      venues = await findCandidates(origins);
      if (mode === "RAIL") {
        // Venues beside stations that suit the group, so the train has somewhere to go.
        const extra = stationVenues(origins.map((o) => o.landmark), loadSnapshot(), railNetwork().stops);
        venues.push(...extra.filter((e) => !venues.some((v) => v.venueId === e.venueId)));
      }
      if (usualVenue && !venues.some((v) => v.venueId === usualVenue.venueId)) venues.push(usualVenue);
      stage = "routing";
      size = `${origins.length}x${venues.length}`;
      started = Date.now();
      matrix = await provider.minutes(origins.map((o) => o.landmark), venues.map((v) => v.location), mode, departureTime ? depart : undefined);
      const note = noteOf(matrix);
      source = `live:${provider.name}${note ? `|${note}` : ""}`; // e.g. "live:openrouteservice|walk:foot-hiking"
    }
  } catch (e) {
    const failure: Failure = { stage, provider: providerName, mode, size, ms: Date.now() - started, error: errorKind(e) };
    console.error(`meet ${describeFailure(failure)}`);
    later(() => alertFailure(failure));
    return { status: 502, body: { error: "upstream failure" } };
  }

  const ranked = rankVenues(venues, matrix, { priorBurden });
  const toResult = (s: VenueScore) => ({
    venueId: s.venue.venueId,
    name: s.venue.name,
    location: s.venue.tags.includes("host") ? null : s.venue.location, // never expose a member's cell
    tags: s.venue.tags,
    worst: Math.round(s.worst),
    spread: Math.round(s.spread),
    total: Math.round(s.total),
    perMember: origins.map((o, i) => {
      const legs = itineraries && mode === "RAIL" ? itinerary(matrix, i, venues.indexOf(s.venue)) : null;
      return {
        memberId: o.memberId,
        minutes: Math.round(s.perMember[i]),
        ...(legs ? { trip: legs.map((l) => ({ ...l, min: Math.round(l.min) })) } : {}),
      };
    }),
  });
  const results = ranked.slice(0, 5).map(toResult);
  if (!usualVenue) return { status: 200, body: { results, source } };

  const place = placeUsual(ranked, usualVenue.venueId);
  const usualResult = place
    ? { ...toResult(ranked[place.index]), rank: place.index + 1, of: place.of }
    : { venueId: usualVenue.venueId, name: usualVenue.name, unreachable: true };
  return { status: 200, body: { results, source, usual: usualResult } };
}
