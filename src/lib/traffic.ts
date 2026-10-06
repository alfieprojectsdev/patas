/**
 * Rough rush-hour ranges for clear-road travel times. Display only: ranking
 * always uses the provider's minutes, so this never changes the order.
 *
 * Basis: ORS driving times between QC landmarks imply 26-37 km/h (measured
 * 2026-10-07). TomTom's Traffic Index puts Metro Manila at about 21 km/h on
 * average (28 min per 10 km, 2025) and 19 km/h at rush hour (2023). That's
 * roughly 1.2-1.9x the ORS times, longest on main-road trips, so the range
 * shown is 1.5x-2x. Replace with traffic-aware precomputed tables (Google
 * Routes per time band) where those exist; this is the planning-mode stopgap.
 */
export const RUSH_HOUR_FACTOR = { low: 1.5, high: 2 } as const;

/** Only clear-road driving estimates get a range: not walking, not traffic-aware or fake times. */
export function showsRushHour(source: string, mode: string): boolean {
  const clearRoad = source === "live:openrouteservice" || source.startsWith("precomputed:openrouteservice:");
  return clearRoad && (mode === "DRIVE" || mode === "TWO_WHEELER");
}

export function rushHourRange(minutes: number): [number, number] {
  return [Math.round(minutes * RUSH_HOUR_FACTOR.low), Math.round(minutes * RUSH_HOUR_FACTOR.high)];
}
