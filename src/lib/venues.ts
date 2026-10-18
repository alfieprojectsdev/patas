import type { Venue } from "./types";
import { loadVenueSnapshot } from "./candidates.ts";
import { landmarkIndex, nearbyLandmarks, normalize, type Landmark } from "./landmarks.ts";
import { snapToCell } from "./h3.ts";

/**
 * Venue search for "our usual spot": the group names the place it always goes
 * to, and Patas ranks it alongside its own picks. Venues are public places
 * from the OSM snapshot, so nothing about a member is involved.
 *
 * Many venues share a name (dozens of plain "Jollibee"), so each one carries
 * its nearest landmark: it's shown as "near Cubao station" and its words are
 * searchable, so "jollibee cubao" finds the right branch.
 */
export type VenueHit = { venueId: string; name: string; category: string; near: string | null };

type Indexed = { v: Venue; near: string | null; norm: string; nameWords: string[]; allWords: string[] };

/** Pure: index venues with the name of their nearest landmark. */
export function indexVenues(venues: readonly Venue[], landmarks: readonly Landmark[]): Indexed[] {
  return venues.map((v) => {
    // Stored at download time by fetch-venues.ts; worked out here only for older snapshots.
    const near = v.near ?? nearbyLandmarks(landmarks, snapToCell(v.location), 1)[0]?.name ?? null;
    const norm = normalize(v.name);
    const nameWords = norm.split(" ");
    return { v, near, norm, nameWords, allWords: [...nameWords, ...(near ? normalize(near).split(" ") : [])] };
  });
}

/**
 * Pure. Same matching as landmark search: every query token must start a word
 * in the name, or in the name plus the nearby landmark. Ranked: name starts
 * with the whole query, then all tokens in the name, then matches that need
 * the landmark; ties go to the shorter name.
 */
export function searchVenues(index: readonly Indexed[], q: string, limit = 8): VenueHit[] {
  const nq = normalize(q);
  if (nq.length < 2) return [];
  const tokens = nq.split(" ");
  const all = (words: string[]) => tokens.every((t) => words.some((w) => w.startsWith(t)));
  const hits: { x: Indexed; score: number }[] = [];
  for (const x of index) {
    if (x.norm.startsWith(nq)) hits.push({ x, score: 0 });
    else if (all(x.nameWords)) hits.push({ x, score: 1 });
    else if (all(x.allWords)) hits.push({ x, score: 2 });
  }
  return hits
    .sort((a, b) => a.score - b.score || a.x.v.name.length - b.x.v.name.length || (a.x.near ?? "").localeCompare(b.x.near ?? ""))
    .slice(0, limit)
    .map(({ x }) => ({ venueId: x.v.venueId, name: x.v.name, category: x.v.tags[0] ?? "", near: x.near }));
}

let cache: Indexed[] | null = null;
export function venueIndex(): Indexed[] {
  if (!cache) {
    // Current snapshots store each venue's landmark; only load the landmark index if one doesn't.
    const venues = loadVenueSnapshot();
    cache = indexVenues(venues, venues.every((v) => v.near) ? [] : landmarkIndex());
  }
  return cache;
}

let byId: Map<string, Venue> | null = null;
export function venueById(id: string): Venue | undefined {
  byId ??= new Map(loadVenueSnapshot().map((v) => [v.venueId, v]));
  return byId.get(id);
}
