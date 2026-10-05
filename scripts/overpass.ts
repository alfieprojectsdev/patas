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
