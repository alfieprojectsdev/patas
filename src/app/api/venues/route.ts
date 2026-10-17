import { NextResponse } from "next/server";
import { z } from "zod";
import { searchVenues, venueIndex } from "@/lib/venues";

export const runtime = "nodejs";

/**
 * POST /api/venues  { q: "jollibee cubao" } → { results: [{ venueId, name, category, near }] }
 *
 * Search for "our usual spot" over the local OSM venue snapshot; nothing
 * leaves our server. POST, like landmark search, so queries stay out of
 * access logs. Don't log `q`.
 */
const Body = z.object({ q: z.string().max(60) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    return NextResponse.json({ results: searchVenues(venueIndex(), parsed.data.q, 8) });
  } catch (e) {
    console.error("venue search failed:", (e as Error).message);
    return NextResponse.json({ error: "venue search unavailable" }, { status: 500 });
  }
}
