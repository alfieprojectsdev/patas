import type { CostMatrix, Venue } from "./types";

/**
 * Precomputed cell→venue travel-time table, one per (mode, time band).
 * Built offline by scripts/precompute.ts; at request time ranking is a lookup:
 * no routing API call, no coordinates sent anywhere.
 *
 * Licence: tables built with openrouteservice are CC-BY-SA 4.0 (HeiGIT
 * terms). Publishing one means publishing it under that licence, with credit.
 *
 * Size check: ~1.5k cells × ~200 venues ≈ 300k entries per band. JSON is OK
 * for the MVP; switch to a packed Uint16 (minutes×10) binary if it grows.
 */
export type TimeBand = "weekday_dismissal" | "weekday_evening" | "weekend_afternoon";

export type PrecomputedTable = {
  version: 1;
  res: number;
  mode: string;
  band: TimeBand;
  provider: string; // e.g. "google-routes", "openrouteservice", "osrm"
  builtAt: string; // ISO date — surface staleness in the UI
  venues: Venue[];
  cells: string[];
  minutes: (number | null)[][]; // [cellIndex][venueIndex]
};

/** Pure: origin cells → CostMatrix over all table venues. Unknown cell → row of nulls. */
export function lookup(table: PrecomputedTable, originCells: string[]): CostMatrix {
  const idx = new Map(table.cells.map((c, i) => [c, i]));
  return originCells.map((c) => {
    const i = idx.get(c);
    return i == null ? table.venues.map(() => null) : table.minutes[i].slice();
  });
}

/** True if every origin cell has a row. Otherwise the caller should route live. */
export function covers(table: PrecomputedTable, originCells: string[]): boolean {
  const known = new Set(table.cells);
  return originCells.every((c) => known.has(c));
}

/** Coarse band from a departure time, Asia/Manila. Placeholder buckets. */
export function bandFor(d: Date): TimeBand {
  const local = new Date(d.getTime() + 8 * 3600_000); // UTC+8, no DST
  const day = local.getUTCDay();
  const hour = local.getUTCHours();
  if (day === 0 || day === 6) return "weekend_afternoon";
  return hour < 17 ? "weekday_dismissal" : "weekday_evening";
}
