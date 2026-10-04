import { NextResponse } from "next/server";
import { z } from "zod";
import { findCandidates } from "@/lib/candidates";
import { getProvider } from "@/lib/routing";
import { rankVenues } from "@/lib/scoring";
import { originInScope } from "@/lib/scope";

/**
 * POST /api/meet
 * Body: { origins: [{memberId, landmark:{lat,lng}}], mode?, priorBurden?, departureTime? }
 * Returns ranked venues with per-member minutes.
 *
 * PRIVACY: origins are used in-memory and discarded. Do not log the request,
 * do not persist coordinates, do not return other members' landmarks.
 * Persist only (group_id, member alias, minutes) via the burdens table if the
 * group opts into rotation.
 */
const Body = z.object({
  origins: z
    .array(
      z.object({
        memberId: z.string().min(1).max(32),
        landmark: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
      }),
    )
    .min(2)
    .max(10),
  mode: z.enum(["DRIVE", "WALK", "TRANSIT", "TWO_WHEELER"]).default("DRIVE"),
  priorBurden: z.array(z.number().nonnegative()).optional(),
  departureTime: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });

  const { origins, mode, priorBurden, departureTime } = parsed.data;
  // Generic message: don't reveal which member is out of area to the group.
  if (!origins.every((o) => originInScope(o.landmark))) {
    return NextResponse.json({ error: "Patas currently covers Quezon City only" }, { status: 422 });
  }
  const provider = getProvider();
  if (!provider.supports.includes(mode)) {
    return NextResponse.json({ error: `mode ${mode} not supported by ${provider.name}` }, { status: 400 });
  }
  try {
    const venues = await findCandidates(origins);
    const matrix = await provider.minutes(
      origins.map((o) => o.landmark),
      venues.map((v) => v.location),
      mode,
      departureTime ? new Date(departureTime) : undefined,
    );
    const ranked = rankVenues(venues, matrix, { priorBurden }).slice(0, 5);

    // Strip member landmarks from host options before returning.
    const safe = ranked.map((s) => ({
      venueId: s.venue.venueId,
      name: s.venue.name,
      location: s.venue.tags.includes("host") ? null : s.venue.location,
      tags: s.venue.tags,
      worst: Math.round(s.worst),
      spread: Math.round(s.spread),
      total: Math.round(s.total),
      perMember: origins.map((o, i) => ({ memberId: o.memberId, minutes: Math.round(s.perMember[i]) })),
    }));
    return NextResponse.json({ results: safe });
  } catch (e) {
    console.error("meet failed:", (e as Error).message); // message only, no payload
    return NextResponse.json({ error: "upstream failure" }, { status: 502 });
  }
}
