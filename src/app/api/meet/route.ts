import { NextResponse } from "next/server";
import { z } from "zod";
import { snapToCell } from "@/lib/h3";
import { meet } from "@/lib/meet";
import { getDb } from "@/lib/db";
import { LIMITS, clientId, retryAfter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30; // routing call has a 20 s timeout

/**
 * POST /api/meet
 * Body: { origins: [{memberId, cell} | {memberId, landmark:{lat,lng}}], mode?, priorBurden?, departureTime? }
 *
 * Single-device planner. Preferred: the client sends H3 res-9 `cell`s.
 * `landmark` is accepted for convenience but snapped immediately.
 * Ranking lives in src/lib/meet.ts (shared with group links).
 *
 * PRIVACY: don't log requests; don't persist cells or coords.
 */
const LatLngZ = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const OriginZ = z.union([
  z.object({ memberId: z.string().min(1).max(32), cell: z.string().min(15).max(16) }),
  z.object({ memberId: z.string().min(1).max(32), landmark: LatLngZ }),
]);
const Body = z.object({
  origins: z.array(OriginZ).min(2).max(10),
  mode: z.enum(["DRIVE", "WALK", "TRANSIT", "TWO_WHEELER"]).default("DRIVE"),
  priorBurden: z.array(z.number().nonnegative()).optional(),
  departureTime: z.string().datetime({ offset: true }).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });

  // Each call can spend routing quota. No database configured = no limit.
  const db = await getDb()?.catch(() => null);
  const wait = db ? await retryAfter(db, LIMITS.meet, clientId(req)) : 0;
  if (wait) return NextResponse.json({ error: "Too many searches. Try again later." }, { status: 429, headers: { "Retry-After": String(wait) } });

  const { status, body } = await meet({
    ...parsed.data,
    // Normalise to cells; drop raw coordinates.
    origins: parsed.data.origins.map((o) => ({ memberId: o.memberId, cell: "cell" in o ? o.cell : snapToCell(o.landmark) })),
  });
  return NextResponse.json(body, { status });
}
