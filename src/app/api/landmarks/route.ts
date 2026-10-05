import { NextResponse } from "next/server";
import { z } from "zod";
import { landmarkIndex, searchLandmarks } from "@/lib/landmarks";

export const runtime = "nodejs";

/**
 * POST /api/landmarks  { q: "sm nor" } → { results: [{ name, kind, area, cell }] }
 *
 * Searches the local OSM landmark snapshot; nothing leaves our server.
 * Returns H3 cells, which the client sends to /api/meet as-is.
 * PRIVACY: POST, not GET, so the query never lands in access logs (dev
 * server and Vercel both log URLs with query strings). Don't log `q`: a
 * typed landmark hints at where a minor lives.
 */
const Body = z.object({ q: z.string().max(60) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const results = searchLandmarks(landmarkIndex(), parsed.data.q, 8).map(({ name, kind, area, cell }) => ({ name, kind, area, cell }));
    return NextResponse.json({ results });
  } catch (e) {
    console.error("landmarks failed:", (e as Error).message);
    return NextResponse.json({ error: "landmark search unavailable" }, { status: 500 });
  }
}
