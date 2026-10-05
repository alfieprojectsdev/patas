import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

let cache: Indexed[] | null = null;
export function landmarkIndex(): Indexed[] {
  if (!cache) {
    const f = join(process.cwd(), process.env.LANDMARKS_SNAPSHOT ?? "data/qc-landmarks.json");
    if (!existsSync(f)) throw new Error("landmark snapshot missing; run scripts/fetch-landmarks.ts");
    cache = indexLandmarks((JSON.parse(readFileSync(f, "utf8")) as LandmarkSnapshot).landmarks);
  }
  return cache;
}
