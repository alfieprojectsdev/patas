import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CostMatrix, LatLng, TravelMode, Venue } from "./types";
import type { MatrixProvider } from "./routing.ts";
import { cellCenter } from "./h3.ts";
import { haversineKm } from "./scoring.ts";
import { categoryRank } from "./candidates.ts";

/**
 * "Train + walking": LRT-1, LRT-2 and MRT-3 on top of walking times.
 *
 * Rail doesn't sit in traffic, so a train trip takes about as long at 6 pm as
 * at 10 am. For each member and venue the time is the faster of walking all
 * the way, or: walk to a station, wait half the time between trains, ride
 * (with transfers), walk to the venue. Getting into a station (security,
 * tapping in) adds `entryMin`, at the start and at each transfer. Run times come from each line's
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
  lines: { id: string; endToEndMin: number; headwayMin: number; stations: { name: string; cell: string }[] }[];
  transfers: { a: [string, string]; b: [string, string]; walkMin: number }[];
};

/** One line's stop at one station. Transfer stations appear once per line. */
export type Stop = { line: string; name: string; point: LatLng; wait: number; entry: number };

/** Walking further than this to or from a station isn't a train trip any more. */
export const MAX_ACCESS_MIN = 30;
/** Only stations this close (straight line) to someone are worth a walking-time request. */
export const STATION_SEARCH_KM = 3;

/**
 * Pure: the stops, and the riding time between every pair of them. `ride[a][b]`
 * covers boarding at a (after the wait) to stepping off at b, including run
 * time, transfer walks and the wait for each later train.
 */
export function buildRail(net: RailNet): { stops: Stop[]; ride: number[][] } {
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
  for (const [a, b, m] of edges) ride[a][b] = Math.min(ride[a][b], m);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (ride[i][k] + ride[k][j] < ride[i][j]) ride[i][j] = ride[i][k] + ride[k][j];
      }
    }
  }
  return { stops, ride };
}

/**
 * Pure. Best of walking and walk + train + walk for every member and venue.
 * `walkOV` is origins × venues; `walkOB` origins × boarding stops `board`;
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
): CostMatrix {
  const ok = (m: number | null | undefined): m is number => m != null && Number.isFinite(m) && m <= MAX_ACCESS_MIN;
  return walkOV.map((row, i) =>
    row.map((walk, j) => {
      let best = walk ?? Infinity;
      board.forEach((b, bi) => {
        const toStation = walkOB[i]?.[bi];
        if (!ok(toStation)) return;
        alight.forEach((a, ai) => {
          const fromStation = walkAV[ai]?.[j];
          if (!ok(fromStation)) return;
          const t = toStation + stops[b].entry + stops[b].wait + ride[b][a] + fromStation;
          if (t < best) best = t;
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

/** Wraps a walking provider. Two walking requests per search: origins → stations and venues; stations → venues. */
export function railProvider(base: MatrixProvider): MatrixProvider {
  return {
    name: `rail+${base.name}`,
    supports: ["RAIL"] as TravelMode[],
    async minutes(origins, destinations) {
      const { stops, ride } = railNetwork();
      const board = near(stops, origins);
      const alight = near(stops, destinations);
      const first = await base.minutes(origins, [...board.map((b) => stops[b].point), ...destinations], "WALK");
      const walkOB = first.map((row) => row.slice(0, board.length));
      const walkOV = first.map((row) => row.slice(board.length));
      const walkAV = board.length && alight.length ? await base.minutes(alight.map((a) => stops[a].point), destinations, "WALK") : [];
      return combineRail(walkOV, walkOB, walkAV, board, alight, stops, ride);
    },
  };
}
