import { NextResponse } from "next/server";
import { z } from "zod";
import { unsealOrigins } from "@/lib/groups";
import { meet } from "@/lib/meet";
import { LIMITS } from "@/lib/rate-limit";
import { GroupIdZ, GroupKeyZ, badInput, dbFor, groupError } from "@/lib/group-api";

export const runtime = "nodejs";

/**
 * POST /api/groups/<id>/meet  { k, mode? } → same shape as /api/meet, with
 * nicknames as memberIds. Cells are unsealed in memory for this request only
 * and never returned.
 */
const Body = z.object({
  k: GroupKeyZ,
  mode: z.enum(["DRIVE", "WALK", "TRANSIT", "TWO_WHEELER"]).default("DRIVE"),
});

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const groupId = GroupIdZ.safeParse((await params).groupId);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!groupId.success || !parsed.success) return badInput();
  const got = await dbFor(req, LIMITS.meet);
  if ("res" in got) return got.res;
  const r = await unsealOrigins(got.db, groupId.data, parsed.data.k);
  if (!r.ok) return groupError(r.error);
  if (r.origins.length < 2) {
    return NextResponse.json({ error: "At least two members need to add a landmark first." }, { status: 409 });
  }
  const { status, body } = await meet({
    origins: r.origins.map((o) => ({ memberId: o.alias, cell: o.cell })),
    mode: parsed.data.mode,
  });
  return NextResponse.json(body, { status });
}
