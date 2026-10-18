/**
 * Offline Overpass fetch with mirror fallback, for the snapshot scripts.
 * Public instances 504 often (2026-10-05: three mirrors failed within an
 * hour of each other succeeding), so try each in turn.
 */
import type { OverpassEl } from "../src/lib/candidates.ts";

const MIRRORS = [
  process.env.OVERPASS_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
].filter(Boolean) as string[];

export type OverpassResult = { elements: OverpassEl[]; osm3s?: { timestamp_osm_base?: string }; host: string };

export async function overpassFetch(query: string, label: string): Promise<OverpassResult> {
  for (const url of MIRRORS) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": `patas/0.1 ${label}${process.env.OVERPASS_CONTACT ? ` (${process.env.OVERPASS_CONTACT})` : ""}`,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log(`${url}: ${json.elements.length} elements in ${Date.now() - t0} ms`);
      return { ...json, host: new URL(url).host };
    } catch (e) {
      console.warn(`${url}: ${(e as Error).message} after ${Date.now() - t0} ms`);
    }
  }
  throw new Error("all Overpass mirrors failed");
}

export type Bbox = { south: number; west: number; north: number; east: number };

/**
 * The same query over a grid of smaller boxes, merged and de-duplicated by
 * element id. Public mirrors refuse one big Metro Manila query (2026-10-18:
 * 504, 500, 504) but take smaller ones. `build` gets each box's Overpass
 * bbox string "south,west,north,east". Each box retries the mirror list up
 * to `rounds` times, a minute apart.
 */
export async function overpassFetchInParts(
  build: (bbox: string) => string,
  box: Bbox,
  label: string,
  { rows = 2, cols = 2, rounds = 3 } = {},
): Promise<OverpassResult> {
  const seen = new Map<string, OverpassEl>();
  let osm3s: OverpassResult["osm3s"];
  let host = "";
  const dLat = (box.north - box.south) / rows;
  const dLng = (box.east - box.west) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const part = [box.south + r * dLat, box.west + c * dLng, box.south + (r + 1) * dLat, box.west + (c + 1) * dLng]
        .map((x) => x.toFixed(5))
        .join(",");
      for (let round = 1; ; round++) {
        try {
          const res = await overpassFetch(build(part), `${label} part ${r * cols + c + 1}/${rows * cols}`);
          for (const el of res.elements) seen.set(`${el.type}/${el.id}`, el);
          osm3s ??= res.osm3s;
          host ||= res.host;
          break;
        } catch (e) {
          if (round >= rounds) throw e;
          console.warn(`part ${r * cols + c + 1}: round ${round} failed, retrying in 60 s`);
          await new Promise((res) => setTimeout(res, 60_000));
        }
      }
    }
  }
  return { elements: [...seen.values()], osm3s, host };
}

/** Snapshot file: header line, then one record per line so diffs stay readable. */
export function snapshotJson(host: string, osmBase: string | undefined, key: string, rows: unknown[]): string {
  const header = {
    source: `OpenStreetMap via ${host}. © OpenStreetMap contributors, ODbL 1.0.`,
    osmBase: osmBase ?? "",
    fetchedAt: new Date().toISOString(),
  };
  const body = rows.map((r) => "  " + JSON.stringify(r)).join(",\n");
  return `${JSON.stringify(header).slice(0, -1)},"${key}":[\n${body}\n]}\n`;
}
