import { cellToBoundary, cellToLatLng, isValidCell, latLngToCell, getResolution, polygonToCells } from "h3-js";
import type { LatLng } from "./types";
import { QC_RING } from "./qc-boundary.ts";

/**
 * H3 snapping — privacy quantization + precompute key.
 *
 * Res 9: avg edge ~200 m, area ~0.105 km². Max snap error ≈ one edge length
 * (~1–2 min drive), inside scoring's 2-min tie tolerance. Res 8 (~530 m edge)
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

/** Hexagon outline as [lat, lng] pairs (Leaflet order), ~1 m precision. For display only. */
export const cellPolygon = (cell: string): [number, number][] =>
  cellToBoundary(cell).map(([lat, lng]) => [+lat.toFixed(5), +lng.toFixed(5)]);

export const isValidOriginCell = (cell: string, res = H3_RES) =>
  isValidCell(cell) && getResolution(cell) === res;

/**
 * Cells whose centres fall inside the QC boundary polygon. These are the
 * precompute origins. Buffer-zone origins (outside QC) aren't in the tables;
 * the API routes those requests live.
 * TODO(claude-code): add buffer cells to precompute if that path gets busy.
 */
export function serviceAreaCells(res = H3_RES): string[] {
  return polygonToCells(QC_RING, res, true);
}
