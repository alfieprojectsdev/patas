import { createHash } from "node:crypto";
import type { MatrixProvider } from "./routing.ts";
import { cellCenter } from "./h3.ts";
import type { TravelMode, Venue } from "./types";

/**
 * The precompute loop, resumable. scripts/precompute.ts runs it: every cell ×
 * every venue, in blocks of chunkOrigins × chunkDest, one provider request per
 * block. Progress is saved every `saveEvery` blocks and when a request fails,
 * so a crash or a quota cut after hours loses at most `saveEvery` blocks. A
 * rerun with the same inputs carries on from the saved blocks; a rerun with
 * different inputs (cells, venues, mode, provider, chunk sizes) starts over,
 * because the saved blocks wouldn't line up.
 */
export type Progress = { fingerprint: string; done: string[]; minutes: (number | null)[][] };

export type RunOptions = {
  cells: string[];
  venues: Venue[];
  mode: TravelMode;
  provider: MatrixProvider;
  chunkOrigins: number;
  chunkDest: number;
  depart?: Date;
  saveEvery?: number;
  sleepMs?: number;
  load: () => Progress | null;
  save: (p: Progress) => void;
  log?: (line: string) => void;
};

/** Pure: identifies one run's inputs, so saved progress is only reused for the same job. */
export function fingerprint(o: Pick<RunOptions, "cells" | "venues" | "mode" | "provider" | "chunkOrigins" | "chunkDest" | "depart">): string {
  const venues = o.venues.map((v) => `${v.venueId}@${v.location.lat},${v.location.lng}`);
  return createHash("sha256")
    .update(JSON.stringify([o.provider.name, o.mode, o.depart?.toISOString() ?? null, o.chunkOrigins, o.chunkDest, o.cells, venues]))
    .digest("hex");
}

export async function runPrecompute(o: RunOptions): Promise<(number | null)[][]> {
  const log = o.log ?? (() => {});
  const fp = fingerprint(o);
  const prev = o.load();
  const resumed = prev?.fingerprint === fp;
  const minutes = resumed ? prev.minutes : o.cells.map(() => o.venues.map(() => null as number | null));
  const done = new Set(resumed ? prev.done : []);
  if (prev && !resumed) log("saved progress is for different inputs; starting over");
  const blocks = Math.ceil(o.cells.length / o.chunkOrigins) * Math.ceil(o.venues.length / o.chunkDest);
  if (resumed) log(`resuming: ${done.size} of ${blocks} blocks already done`);

  const save = () => o.save({ fingerprint: fp, done: [...done], minutes });
  const destPts = o.venues.map((v) => v.location);
  let unsaved = 0;
  for (let i0 = 0; i0 < o.cells.length; i0 += o.chunkOrigins) {
    const oPts = o.cells.slice(i0, i0 + o.chunkOrigins).map(cellCenter);
    for (let j0 = 0; j0 < o.venues.length; j0 += o.chunkDest) {
      const key = `${i0}:${j0}`;
      if (done.has(key)) continue;
      let block;
      try {
        block = await o.provider.minutes(oPts, destPts.slice(j0, j0 + o.chunkDest), o.mode, o.depart);
      } catch (e) {
        save(); // keep what's done; the rerun picks up here
        throw e;
      }
      block.forEach((row, di) => row.forEach((m, dj) => (minutes[i0 + di][j0 + dj] = m)));
      done.add(key);
      if (++unsaved >= (o.saveEvery ?? 20)) {
        save();
        unsaved = 0;
      }
      if (done.size % 20 === 0) log(`${done.size}/${blocks}`);
      if (o.sleepMs) await new Promise((r) => setTimeout(r, o.sleepMs));
    }
  }
  save();
  return minutes;
}
