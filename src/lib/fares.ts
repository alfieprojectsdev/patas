/**
 * Fare estimation — STUB. This is the hard, PH-specific part.
 *
 * Plan:
 *  - Encode LTFRB fare matrices per mode (traditional/modern jeep, bus, UV)
 *    as data files: base fare covers first N km, then per-km increments.
 *  - Student/minor discount (20%) applies on most PUVs — confirm current rules.
 *  - Rail (LRT/MRT) is station-pair based; needs its own lookup tables.
 *  - Tricycle fares are LGU-set and vary by municipality — likely user-entered.
 *
 * Until then the app optimizes on minutes only. Keep cost and time as
 * separate objectives; don't silently blend them with a made-up peso/min rate.
 */
export type FareEstimate = { pesos: number; confidence: "low" | "medium" | "high" };

export function estimateFare(_distanceKm: number, _mode: string): FareEstimate | null {
  return null; // TODO(claude-code)
}
