import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cellToLatLng, greatCircleDistance, gridDiskDistances } from "h3-js";

/**
 * Landmark search over a local OSM snapshot (data/qc-landmarks.json, built by
 * scripts/fetch-landmarks.ts).
 *
 * Why local instead of Places/Photon autocomplete:
 *  - keystrokes reach only our server, and no API key is needed;
 *  - members can only pick public landmarks (stations, schools, malls,
 *    churches, barangay halls), never a home address;
 *  - the snapshot stores H3 res-9 cells, not coordinates, so the client gets
 *    a cell id and sends that straight back to /api/meet.
 */
export const LANDMARK_KINDS = [
  "station", "mall", "area", "university", "school", "hospital", "church", "barangay_hall", "market", "park",
] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export type Landmark = {
  name: string;
  kind: LandmarkKind;
  area: string; // addr:city, else "Quezon City" / "near QC"; helps tell same-name parishes apart
  cell: string; // H3 res 9
  aka?: string[]; // short_name / alt_name, e.g. "UP Diliman"
};

export type LandmarkSnapshot = { source: string; osmBase: string; fetchedAt: string; landmarks: Landmark[] };

type Indexed = Landmark & { norm: string; nameWords: string[]; allWords: string[] };

export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function indexLandmarks(list: Landmark[]): Indexed[] {
  return list.map((l) => {
    const norm = normalize(l.name);
    const nameWords = norm.split(" ");
    const allWords = [...nameWords, ...(l.aka ?? []).flatMap((a) => normalize(a).split(" "))];
    return { ...l, norm, nameWords, allWords };
  });
}

/**
 * Pure. Every query token must match the start of a word in the name or an
 * alias ("sm nor" → "SM City North EDSA"). Ranked: name starts with the whole
 * query, then all tokens found in the name, then matches that need an alias;
 * ties go to the more useful kind (stations and malls first), then the
 * shorter name.
 */
export function searchLandmarks(index: Indexed[], q: string, limit = 8): Landmark[] {
  const nq = normalize(q);
  if (nq.length < 2) return [];
  const tokens = nq.split(" ");
  const all = (words: string[]) => tokens.every((t) => words.some((w) => w.startsWith(t)));
  const hits: { l: Indexed; score: number }[] = [];
  for (const l of index) {
    if (l.norm.startsWith(nq)) hits.push({ l, score: 0 });
    else if (all(l.nameWords)) hits.push({ l, score: 1 });
    else if (all(l.allWords)) hits.push({ l, score: 2 });
  }
  const kindRank = (k: LandmarkKind) => LANDMARK_KINDS.indexOf(k);
  return hits
    .sort((a, b) => a.score - b.score || kindRank(a.l.kind) - kindRank(b.l.kind) || a.l.name.length - b.l.name.length)
    .slice(0, limit)
    .map(({ l: { norm: _n, nameWords: _nw, allWords: _aw, ...rest } }) => rest);
}

/**
 * How far "Find it on the map" looks: 6 rings of res-9 cells, centres ~300 m
 * apart, so about 1.5–1.8 km. Past that a landmark is no help to the ranking.
 */
export const NEAR_RINGS = 6;

const byCellCache = new WeakMap<readonly Landmark[], Map<string, Landmark[]>>();
function byCell<T extends Landmark>(list: readonly T[]): Map<string, T[]> {
  let m = byCellCache.get(list) as Map<string, T[]> | undefined;
  if (!m) {
    m = new Map();
    for (const l of list) m.set(l.cell, [...(m.get(l.cell) ?? []), l]);
    byCellCache.set(list, m);
  }
  return m;
}

/**
 * Pure. Landmarks nearest a map pin's cell, for people who can't find a place
 * by name ("SNR" vs "S&R"). The pin only helps pick a landmark; it is never an
 * origin itself, so inputs stay public places. Sorted by distance between cell
 * centres, then kind (stations and malls first), then shorter name.
 */
export function nearbyLandmarks<T extends Landmark>(
  list: readonly T[],
  cell: string,
  limit = 5,
  maxRing = NEAR_RINGS,
): (T & { metres: number })[] {
  const cells = byCell(list);
  const [lat, lng] = cellToLatLng(cell);
  const found: T[] = [];
  // Once there are enough, read one more ring: hex rings overlap in distance.
  let lastRing = maxRing;
  for (const [k, ring] of gridDiskDistances(cell, maxRing).entries()) {
    for (const c of ring) found.push(...(cells.get(c) ?? []));
    if (lastRing === maxRing && found.length >= limit) lastRing = Math.min(k + 1, maxRing);
    if (k >= lastRing) break;
  }
  const kindRank = (k: LandmarkKind) => LANDMARK_KINDS.indexOf(k);
  return found
    .map((l) => ({ ...l, metres: Math.round(greatCircleDistance([lat, lng], cellToLatLng(l.cell), "m") / 10) * 10 }))
    .sort((a, b) => a.metres - b.metres || kindRank(a.kind) - kindRank(b.kind) || a.name.length - b.name.length)
    .slice(0, limit);
}

let cache: Indexed[] | null = null;
export function landmarkIndex(): Indexed[] {
  if (!cache) {
    const f = join(process.cwd(), process.env.LANDMARKS_SNAPSHOT ?? "data/qc-landmarks.json");
    if (!existsSync(f)) throw new Error("landmark snapshot missing; run scripts/fetch-landmarks.ts");
    cache = indexLandmarks((JSON.parse(readFileSync(f, "utf8")) as LandmarkSnapshot).landmarks);
  }
  return cache;
}
