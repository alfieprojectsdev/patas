import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidOriginCell } from "@/lib/h3";
import { joinGroup } from "@/lib/groups";
import { LIMITS } from "@/lib/rate-limit";
import { AliasZ, GroupIdZ, GroupKeyZ, badInput, dbFor, groupError } from "@/lib/group-api";

export const runtime = "nodejs";

/**
 * POST /api/groups/<id>/join  { k, alias, cell, memberToken? } → { memberToken }
 * The cell is sealed under K before it's stored. Sending your own
 * memberToken updates your entry instead of adding a new one.
 */
const Body = z.object({
  k: GroupKeyZ,
  alias: AliasZ,
  cell: z.string().refine((c) => isValidOriginCell(c)),
  memberToken: z.string().max(64).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const groupId = GroupIdZ.safeParse((await params).groupId);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!groupId.success || !parsed.success) return badInput();
  const got = await dbFor(req, LIMITS.groupJoin);
  if ("res" in got) return got.res;
  const r = await joinGroup(got.db, { groupId: groupId.data, ...parsed.data });
  return r.ok ? NextResponse.json({ memberToken: r.memberToken }) : groupError(r.error);
}
