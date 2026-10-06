import { NextResponse } from "next/server";
import { z } from "zod";
import { groupStatus } from "@/lib/groups";
import { GroupIdZ, GroupKeyZ, badInput, dbFor, groupError } from "@/lib/group-api";

export const runtime = "nodejs";

/**
 * POST /api/groups/<id>  { k, memberToken? } → { members: [{alias, ready, you}], expiresAt }
 * POST, not GET, so K stays out of the URL. Returns no locations.
 */
const Body = z.object({ k: GroupKeyZ, memberToken: z.string().max(64).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const groupId = GroupIdZ.safeParse((await params).groupId);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!groupId.success || !parsed.success) return badInput();
  const got = await dbFor(req);
  if ("res" in got) return got.res;
  const r = await groupStatus(got.db, groupId.data, parsed.data.k, parsed.data.memberToken);
  return r.ok ? NextResponse.json({ members: r.members, expiresAt: r.expiresAt }) : groupError(r.error);
}
