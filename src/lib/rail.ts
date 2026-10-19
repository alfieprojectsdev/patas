import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CostMatrix, LatLng, TravelMode, Venue } from "./types";
import { noteOf, withNote, type MatrixProvider } from "./routing.ts";
import { cellCenter } from "./h3.ts";
import { haversineKm } from "./scoring.ts";
import { categoryRank, loadVenueSnapshot } from "./candidates.ts";

/**
 * "Train": LRT-1, LRT-2 and MRT-3 on top of walking times, with a ride to the station when it's faster.
 *
 * Rail doesn't sit in traffic, so a train trip takes about as long at 6 pm as
 * at 10 am. For each member and venue the time is the faster of walking all
 * the way, or: get to a station, wait half the time between trains, ride
 * (with transfers), walk to the venue. Getting to the station is a walk or,
 * when it's faster, a car, taxi or tricycle ride: clear-road driving time plus
 * `rideWaitMin` to get one. Only that first leg can be a ride; a ride all the
 * way would just be the Car mode. Getting into a station (security, tapping
 * in) adds `entryMin`, at the start and at each transfer. Run times come from each line's
 * end-to-end minutes, split between stations by distance. All figures are in
 * data/rail.json (built by scripts/fetch-rail.ts from data/rail-lines.json),
 * with their sources.
 *
 * Privacy: stations are public places stored as H3 cells; no itinerary
 * (boarding or alighting station) is returned, because in a group it would
 * hint at another member's area.
 */
export type RailNet = {
  /** Getting through security and tapping in, at boarding and at each transfer. */
  entryMin?: number;
  /** Getting a ride to the station: booking and waiting, before the drive itself. */
  rideWaitMin?: number;
  lines: { id: string; endToEndMin: number; headwayMin: number; stations: { name: string; cell: string }[] }[];
  transfers: { a: [string, string]; b: [string, string]; walkMin: number }[];
};

/** One line's stop at one station. Transfer stations appear once per line. */
export type Stop = { line: string; name: string; point: LatLng; wait: number; entry: number };

/** Walking to or from a station for longer than this isn't a train trip any more. */
export const MAX_ACCESS_MIN = 30;
/**
 * A ride to the station (plus its wait) may take longer: from Fairview, the
 * nearest station (North Avenue) is about 10 km off. Past this it's a car trip
 * with a train ride tacked on, and the clear-road time is too optimistic to trust.
 */
export const MAX_RIDE_MIN = 45;
/** Only stations this close (straight line) to someone are worth a walking-time request. */
export const STATION_SEARCH_KM = 3;
/** For the ride to a station: each member's nearest few stations, within this distance. */
export const RIDE_STATIONS = 3;
export const RIDE_SEARCH_KM = 12;

/**
 * Pure: the stops, and the riding time between every pair of them. `ride[a][b]`
 * covers boarding at a (after the wait) to stepping off at b, including run
 * time, transfer walks and the wait for each later train.
 */
export type RailGraph = {
  stops: Stop[];
  /** Minutes from boarding at a (after the wait) to stepping off at b. */
  ride: number[][];
  /** First stop after a on the fastest way to b (-1: none), for itineraries. */
  next: number[][];
  /** Minutes of each direct hop "a>b": run time, or for a transfer the walk plus the next line's entry and wait. */
  hop: Map<string, number>;
  /** Whether the fastest way from a to b rides at least one train. Not when a is b, or for a transfer walk alone. */
  usesTrain: boolean[][];
  rideWait: number;
};

export function buildRail(net: RailNet): RailGraph {
  const stops: Stop[] = [];
  const index = new Map<string, number>();
  const edges: [number, number, number][] = [];
  for (const line of net.lines) {
    const pts = line.stations.map((s) => cellCenter(s.cell));
    const gaps = pts.slice(1).map((p, i) => haversineKm(pts[i], p));
    const length = gaps.reduce((a, b) => a + b, 0);
    line.stations.forEach((s, i) => {
      index.set(`${line.id}|${s.name}`, stops.length);
      stops.push({ line: line.id, name: s.name, point: pts[i], wait: line.headwayMin / 2, entry: net.entryMin ?? 0 });
    });
    const first = stops.length - line.stations.length;
    gaps.forEach((g, i) => {
      const minutes = (g / length) * line.endToEndMin;
      edges.push([first + i, first + i + 1, minutes], [first + i + 1, first + i, minutes]);
    });
  }
  for (const t of net.transfers) {
    const a = index.get(t.a.join("|"));
    const b = index.get(t.b.join("|"));
    if (a == null || b == null) throw new Error(`rail transfer names an unknown stop: ${t.a} / ${t.b}`);
    edges.push([a, b, t.walkMin + stops[b].entry + stops[b].wait], [b, a, t.walkMin + stops[a].entry + stops[a].wait]);
  }
  // Floyd–Warshall: about 50 stops, so 125,000 steps, once per process.
  const n = stops.length;
  const ride = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  const next = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? i : -1)));
  const hop = new Map<string, number>();
  for (const [a, b, m] of edges) {
    if (m < ride[a][b]) {
      ride[a][b] = m;
      next[a][b] = b;
      hop.set(`${a}>${b}`, m);
    }
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (ride[i][k] + ride[k][j] < ride[i][j]) {
          ride[i][j] = ride[i][k] + ride[k][j];
          next[i][j] = next[i][k];
        }
      }
    }
  }
  const usesTrain = stops.map((_, a) =>
    stops.map((_, b) => {
      const path = railPath(next, a, b);
      return path.some((p, k) => k > 0 && stops[path[k - 1]].line === stops[p].line);
    }),
  );
  return { stops, ride, next, hop, usesTrain, rideWait: net.rideWaitMin ?? 0 };
}

/**
 * Pure. Minutes from each member to each boarding stop in `board` (the union
 * of `walkStops` and `rideStops`): the faster of walking and riding (drive +
 * `rideWait`), within MAX_ACCESS_MIN and MAX_RIDE_MIN; null if neither is.
 * `walk` is origins × walkStops, `drive` origins × rideStops.
 */
export function accessTimes(
  walk: CostMatrix,
  walkStops: number[],
  drive: CostMatrix,
  rideStops: number[],
  rideWait: number,
): { board: number[]; access: CostMatrix; how: ("walk" | "ride" | null)[][] } {
  const board = [...new Set([...walkStops, ...rideStops])];
  const within = (cap: number) => (m: number | null | undefined): m is number => m != null && Number.isFinite(m) && m <= cap;
  const walkOk = within(MAX_ACCESS_MIN);
  const rideOk = within(MAX_RIDE_MIN);
  const how: ("walk" | "ride" | null)[][] = [];
  const access = walk.map((_, i) => {
    how[i] = [];
    return board.map((s, bi) => {
      const w = walk[i]?.[walkStops.indexOf(s)];
      const d = drive[i]?.[rideStops.indexOf(s)];
      const r = d == null ? null : d + rideWait;
      const byWalk = walkOk(w) ? w : Infinity;
      const byRide = rideOk(r) ? r : Infinity;
      const best = Math.min(byWalk, byRide);
      how[i][bi] = !Number.isFinite(best) ? null : byWalk <= byRide ? "walk" : "ride";
      return Number.isFinite(best) ? best : null;
    });
  });
  return { board, access, how };
}

/**
 * Pure. Best of walking and (walk or ride) + train + walk for every member and venue.
 * `walkOV` is origins × venues; `walkOB` origins × boarding stops `board`, by any way of getting there;
 * `walkAV` alighting stops `alight` × venues. Indices in board/alight point
 * into `stops`/`ride`.
 */
export function combineRail(
  walkOV: CostMatrix,
  walkOB: CostMatrix,
  walkAV: CostMatrix,
  board: number[],
  alight: number[],
  stops: Stop[],
  ride: number[][],
  /**
   * If given, only pairs that ride a train count (RailGraph.usesTrain). Without
   * it, a ride to a station next to the venue counted as a train trip: a car
   * trip plus the minutes for getting into a station, with no train at all.
   */
  usesTrain?: boolean[][],
  /** If given, filled with the boarding and alighting indices (into board/alight) behind each time; null = walk all the way. */
  picks?: ({ bi: number; ai: number } | null)[][],
): CostMatrix {
  const ok = (m: number | null | undefined): m is number => m != null && Number.isFinite(m) && m <= MAX_ACCESS_MIN;
  return walkOV.map((row, i) =>
    row.map((walk, j) => {
      let best = walk ?? Infinity;
      if (picks) (picks[i] ??= [])[j] = null;
      board.forEach((b, bi) => {
        const toStation = walkOB[i]?.[bi]; // capped by accessTimes
        if (toStation == null || !Number.isFinite(toStation)) return;
        alight.forEach((a, ai) => {
          if (usesTrain && !usesTrain[b][a]) return;
          const fromStation = walkAV[ai]?.[j];
          if (!ok(fromStation)) return;
          const t = toStation + stops[b].entry + stops[b].wait + ride[b][a] + fromStation;
          if (t < best) {
            best = t;
            if (picks) picks[i][j] = { bi, ai };
          }
        });
      });
      return Number.isFinite(best) ? best : null;
    }),
  );
}

let cache: ReturnType<typeof buildRail> | null = null;
export function railNetwork() {
  if (!cache) {
    const f = join(process.cwd(), process.env.RAIL_FILE ?? "data/rail.json");
    if (!existsSync(f)) throw new Error("rail network missing; run scripts/fetch-rail.ts");
    cache = buildRail(JSON.parse(readFileSync(f, "utf8")) as RailNet);
  }
  return cache;
}

/** Station-to-venue walks: venue location → stop index → minutes. */
export type WalkTable = Map<string, Map<number, number>>;
const locKey = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

let walkCache: WalkTable | null = null;
/**
 * The last leg, station to venue, from data/rail-walks.json (built offline by
 * scripts/fetch-rail-walks.ts). Asking for it live meant every station near
 * any venue times every venue, pairs up to 30 km apart, and openrouteservice
 * refused it (error 6020). Venues outside the snapshot, such as a member's
 * own area offered as a host option, have no entry: no train to them.
 */
export function railWalks(stops: Stop[]): WalkTable {
  if (!walkCache) {
    const f = join(process.cwd(), process.env.RAIL_WALKS_FILE ?? "data/rail-walks.json");
    if (!existsSync(f)) throw new Error("station walks missing; run scripts/fetch-rail-walks.ts");
    const { walks } = JSON.parse(readFileSync(f, "utf8")) as { walks: Record<string, Record<string, number>> };
    const where = new Map(loadVenueSnapshot().map((v) => [v.venueId, v.location]));
    const stopIndex = new Map(stops.map((s, i) => [`${s.line}|${s.name}`, i]));
    const table: WalkTable = new Map();
    let unknown = 0;
    for (const [stop, row] of Object.entries(walks)) {
      const i = stopIndex.get(stop);
      if (i == null) continue;
      for (const [venueId, minutes] of Object.entries(row)) {
        const loc = where.get(venueId);
        if (!loc) {
          unknown++;
          continue;
        }
        const k = locKey(loc);
        if (!table.has(k)) table.set(k, new Map());
        table.get(k)!.set(i, minutes);
      }
    }
    // Venue ids change when the snapshot is rebuilt; those venues lose their train egress until the table is rebuilt too.
    if (unknown) console.warn(`rail-walks: ${unknown} walks name venues not in the snapshot; run npm run fetch:rail-walks`);
    walkCache = table;
  }
  return walkCache;
}

/** Pure: the stops anyone can alight at for these destinations, and stops × destinations minutes (null: no walk). */
export function lookupWalks(table: WalkTable, destinations: LatLng[]): { alight: number[]; walkAV: CostMatrix } {
  const rows = destinations.map((d) => table.get(locKey(d)));
  const alight = [...new Set(rows.flatMap((r) => (r ? [...r.keys()] : [])))];
  return { alight, walkAV: alight.map((a) => rows.map((r) => r?.get(a) ?? null)) };
}

/**
 * Pure. Venues beside the stations that suit the group: the `stations`
 * stations whose farthest member is nearest (straight line), and for each the
 * best venue within `radiusKm`. The usual shortlist is chosen by straight-line
 * distance, so without these the train rarely gets a venue it can reach.
 */
export function stationVenues(
  origins: LatLng[],
  pool: readonly Venue[],
  stops: Stop[],
  { stations = 10, radiusKm = 0.5 } = {},
): Venue[] {
  const ranked = [...stops].sort(
    (a, b) => Math.max(...origins.map((o) => haversineKm(o, a.point))) - Math.max(...origins.map((o) => haversineKm(o, b.point))),
  );
  const picked: Venue[] = [];
  const used: LatLng[] = [];
  for (const s of ranked) {
    if (used.length >= stations) break;
    if (used.some((p) => haversineKm(p, s.point) < 0.4)) continue; // one per transfer pair
    used.push(s.point);
    const best = pool
      .filter((v) => haversineKm(v.location, s.point) <= radiusKm)
      .sort((a, b) => categoryRank(a) - categoryRank(b) || haversineKm(a.location, s.point) - haversineKm(b.location, s.point))[0];
    if (best) picked.push(best);
  }
  return picked;
}

const near = (stops: Stop[], pts: LatLng[]) =>
  stops.flatMap((s, i) => (pts.some((p) => haversineKm(p, s.point) <= STATION_SEARCH_KM) ? [i] : []));

/** Each origin's RIDE_STATIONS nearest stops within RIDE_SEARCH_KM, merged. */
const rideCandidates = (stops: Stop[], pts: LatLng[]) => [
  ...new Set(
    pts.flatMap((p) =>
      stops
        .map((s, i) => ({ i, km: haversineKm(p, s.point) }))
        .filter((x) => x.km <= RIDE_SEARCH_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, RIDE_STATIONS)
        .map((x) => x.i),
    ),
  ),
];

/** How long a Train search waits for the optional ride leg (driving answers in about 1 s when it works). */
export const RIDE_WAIT = { ms: 8000 };

/** The ride leg, or null if driving fails or takes longer than RIDE_WAIT. Logs a label only, never the error text. */
async function optionalRides(drive: Promise<CostMatrix>): Promise<CostMatrix | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = (why: string) => {
    console.error(`rail: driving to stations failed (${why}); walking to stations only`);
    return null;
  };
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(giveUp(`no answer in ${RIDE_WAIT.ms} ms`)), RIDE_WAIT.ms)));
  try {
    return await Promise.race([
      // Our provider errors are short ("ORS 503"); anything else (a JSON parse error quotes the body) gets its name only.
      drive.catch((e: Error) =>
        giveUp(
          e.name === "TimeoutError" ? "timeout"
          : e.name === "TypeError" && /fetch failed/i.test(e.message) ? "network error"
          : /^(ORS|Routes API) \d+$/.test(e.message) ? e.message
          : e.name,
        ),
      ),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** One leg of a member's train trip. Minutes add up to the trip's total. */
export type Leg =
  | { kind: "walk"; min: number; to?: string } // to a station, or (no `to`) to the venue
  | { kind: "ride"; min: number; to: string } // car, taxi or tricycle to a station, including getting one
  | { kind: "train"; line: string; from: string; to: string; min: number } // including the wait and getting in
  | { kind: "transfer"; to: string; min: number }; // walk between lines

/** What railProvider decided for each member and destination, kept beside the matrix for itineraries. */
type Trips = {
  graph: RailGraph;
  walkOV: CostMatrix;
  board: number[];
  access: CostMatrix;
  how: ("walk" | "ride" | null)[][];
  alight: number[];
  walkAV: CostMatrix;
  picks: ({ bi: number; ai: number } | null)[][];
};
const trips = new WeakMap<CostMatrix, Trips>();

const label = (s: Stop) => `${s.name} (${s.line})`;

/** Pure: the stops from a to b on the fastest way, both ends included. */
export function railPath(next: number[][], a: number, b: number): number[] {
  if (next[a][b] < 0) return [];
  const path = [a];
  for (let at = a; at !== b; ) path.push((at = next[at][b]));
  return path;
}

/**
 * Member i's trip to destination j, from a matrix railProvider returned; null
 * if it didn't come from railProvider or there's no trip. Single-phone planner
 * only: in a group, the stations would hint at where someone starts.
 */
export function itinerary(matrix: CostMatrix, i: number, j: number): Leg[] | null {
  const t = trips.get(matrix);
  const total = matrix[i]?.[j];
  if (!t || total == null) return null;
  const pick = t.picks[i]?.[j];
  if (!pick) return [{ kind: "walk", min: total }];
  const { stops, next, hop } = t.graph;
  const b = t.board[pick.bi];
  const a = t.alight[pick.ai];
  const legs: Leg[] = [{ kind: t.how[i][pick.bi] === "ride" ? "ride" : "walk", min: t.access[i][pick.bi]!, to: label(stops[b]) }];
  const path = railPath(next, b, a);
  let from = b;
  let run = stops[b].entry + stops[b].wait;
  for (let k = 1; k < path.length; k++) {
    const [p, q] = [path[k - 1], path[k]];
    const m = hop.get(`${p}>${q}`)!;
    if (stops[p].line === stops[q].line) {
      run += m;
      continue;
    }
    // A transfer: close the train leg, walk across, and the next leg starts with the new line's entry and wait.
    legs.push({ kind: "train", line: stops[p].line, from: label(stops[from]), to: label(stops[p]), min: run });
    const across = stops[q].entry + stops[q].wait;
    legs.push({ kind: "transfer", to: label(stops[q]), min: m - across });
    from = q;
    run = across;
  }
  legs.push({ kind: "train", line: stops[a].line, from: label(stops[from]), to: label(stops[a]), min: run });
  legs.push({ kind: "walk", min: t.walkAV[pick.ai][j]! });
  return legs;
}

/**
 * Wraps a walking (and driving) provider. Two requests per search, in
 * parallel: walking from origins to nearby stations and the venues; driving
 * from origins to their nearest stations (skipped if the provider can't
 * drive). Station to venue comes from the station-walk table.
 *
 * The ride is optional: if the driving request fails, the search goes on with
 * walks to stations only and the times carry the note "rail:no-rides". On
 * 2026-10-18 one live Train search failed because driving didn't answer in 20 s.
 */
export function railProvider(base: MatrixProvider): MatrixProvider {
  return {
    name: `rail+${base.name}`,
    supports: ["RAIL"] as TravelMode[],
    async minutes(origins, destinations) {
      const graph = railNetwork();
      const { stops, ride, rideWait } = graph;
      const walkStops = near(stops, origins);
      let rideStops = base.supports.includes("DRIVE") ? rideCandidates(stops, origins) : [];
      const { alight, walkAV } = lookupWalks(railWalks(stops), destinations);
      const pts = (ix: number[]) => ix.map((i) => stops[i].point);
      const [first, drive] = await Promise.all([
        base.minutes(origins, [...pts(walkStops), ...destinations], "WALK"),
        rideStops.length ? optionalRides(base.minutes(origins, pts(rideStops), "DRIVE")) : Promise.resolve([] as CostMatrix),
      ]);
      const noRides = drive === null;
      if (noRides) rideStops = [];
      const walkOB = first.map((row) => row.slice(0, walkStops.length));
      const walkOV = first.map((row) => row.slice(walkStops.length));
      const { board, access, how } = accessTimes(walkOB, walkStops, drive ?? [], rideStops, rideWait);
      // Keep the walking provider's note ("walk:foot-hiking") on the combined times, plus our own.
      const notes = [noteOf(first), noRides ? "rail:no-rides" : undefined].filter(Boolean).join("|");
      const picks: ({ bi: number; ai: number } | null)[][] = [];
      const result = combineRail(walkOV, access, walkAV, board, alight, stops, ride, graph.usesTrain, picks);
      trips.set(result, { graph, walkOV, board, access, how, alight, walkAV, picks });
      return withNote(result, notes || undefined);
    },
  };
}
