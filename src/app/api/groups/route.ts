import { NextResponse } from "next/server";
import { z } from "zod";
import { createGroup } from "@/lib/groups";
import { LIMITS } from "@/lib/rate-limit";
import { GroupKeyZ, badInput, dbFor, purgeSoon } from "@/lib/group-api";

export const runtime = "nodejs";

/**
 * POST /api/groups  { k } → { groupId, expiresAt }
 * K is made in the organiser's browser; the server keeps only sha256(K).
 * The share link is /g/<groupId>#k=<K>.
 */
const Body = z.object({ k: GroupKeyZ });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badInput();
  const got = await dbFor(req, LIMITS.groupCreate);
  if ("res" in got) return got.res;
  purgeSoon(got.db);
  return NextResponse.json(await createGroup(got.db, parsed.data.k), { status: 201 });
}
