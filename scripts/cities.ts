/** Which Metro Manila city a point is in, from data/mm-cities.json (built by fetch-cities.ts). Snapshot scripts only. */
import { readFileSync } from "node:fs";
import { pointInRing } from "../src/lib/scope.ts";
import type { LatLng } from "../src/lib/types";

type Cities = { cities: { name: string; rings: [number, number][][] }[] };
const { cities } = JSON.parse(readFileSync("data/mm-cities.json", "utf8")) as Cities;

export function cityOf(p: LatLng): string | null {
  return cities.find((c) => c.rings.some((r) => pointInRing(p, r)))?.name ?? null;
}
