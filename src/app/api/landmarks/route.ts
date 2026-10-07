import { NextResponse } from "next/server";
import { z } from "zod";
import { landmarkIndex, nearbyLandmarks, searchLandmarks } from "@/lib/landmarks";
import { cellPolygon, isValidOriginCell } from "@/lib/h3";

export const runtime = "nodejs";

/**
 * POST /api/landmarks  { q: "sm nor" } → { results: [{ name, kind, area, cell, hex }] }
 * POST /api/landmarks  { cell }        → the same, nearest first, plus `metres`
 *
 * Searches the local OSM landmark snapshot; nothing leaves our server.
 * Returns H3 cells, which the client sends to /api/meet as-is. `cell` is the
 * res-9 cell under the map pin ("Find it on the map"); the client snaps it,
 * so no coordinates arrive here.
 * PRIVACY: POST, not GET, so the query never lands in access logs (dev
 * server and Vercel both log URLs with query strings). Don't log `q` or
 * `cell`: either one hints at where a minor lives.
 */
const Body = z.union([
  z.object({ q: z.string().max(60) }),
  z.object({ cell: z.string().min(15).max(16).refine((c) => isValidOriginCell(c)) }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const body = parsed.data;
    const found = "q" in body ? searchLandmarks(landmarkIndex(), body.q, 8) : nearbyLandmarks(landmarkIndex(), body.cell, 5);
    const results = found.map((l) => ({
      name: l.name,
      kind: l.kind,
      area: l.area,
      cell: l.cell,
      hex: cellPolygon(l.cell), // the ~200 m cell outline: no more precise than `cell` itself
      ...("metres" in l ? { metres: l.metres } : {}),
    }));
    return NextResponse.json({ results });
  } catch (e) {
    console.error("landmarks failed:", (e as Error).message);
    return NextResponse.json({ error: "landmark search unavailable" }, { status: 500 });
  }
}
