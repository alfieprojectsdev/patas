import { cellToLatLng, isValidCell, latLngToCell, getResolution, polygonToCells } from "h3-js";
import type { LatLng } from "./types";
import { QC_BBOX } from "./scope.ts";

/**
 * H3 snapping — privacy quantization + precompute key.
 *
 * Res 9: avg edge ~200 m, area ~0.105 km². Max snap error ≈ one edge length
 * (~1–2 min drive), inside scoring's 5-min tie tolerance. Res 8 (~530 m edge)
 * can exceed it — don't drop below 9 without re-checking tolerance.
 *
 * Intended flow: the CLIENT snaps the landmark to a cell and sends only the
 * cell id. Exact coordinates never leave the device.
 */
export const H3_RES = 9;

export const snapToCell = (p: LatLng, res = H3_RES): string => latLngToCell(p.lat, p.lng, res);

export function cellCenter(cell: string): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

export const isValidOriginCell = (cell: string, res = H3_RES) =>
  isValidCell(cell) && getResolution(cell) === res;

/**
 * Cells covering the service area. Uses the bbox for now (~3.6k cells at
 * res 9 — over-covers QC). TODO(claude-code): feed the OSM QC boundary
 * polygon instead (~1.5k cells) and reuse the resulting cell SET as the
 * in-scope test — cheaper than point-in-polygon (same trick Grab uses with
 * geohashes for road localisation).
 */
export function serviceAreaCells(res = H3_RES): string[] {
  const b = QC_BBOX;
  return polygonToCells(
    [[b.south, b.west], [b.south, b.east], [b.north, b.east], [b.north, b.west]],
    res,
  );
}
