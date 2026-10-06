import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, type Db } from "./db.ts";
import { isGroupKey } from "./seal.ts";
import { purgeExpired, type GroupError } from "./groups.ts";
import { clientId, retryAfter, type Limit } from "./rate-limit.ts";

/**
 * Shared bits for the /api/groups routes. The group key travels in the
 * request body (never the URL), so it can't land in access logs.
 * PRIVACY: never log request bodies here; they carry K and cells.
 */
export const GroupKeyZ = z.string().refine(isGroupKey, "bad key");
export const GroupIdZ = z.string().uuid();
export const AliasZ = z.string().trim().min(1).max(20);

const MESSAGES: Record<GroupError, [number, string]> = {
  NOT_FOUND: [404, "This group link isn't valid any more. Ask for a fresh one."],
  ALIAS_TAKEN: [409, "Someone in the group already uses that nickname."],
  GROUP_FULL: [409, "This group already has 10 members."],
};

export const groupError = (e: GroupError) => NextResponse.json({ error: MESSAGES[e][1], code: e }, { status: MESSAGES[e][0] });
export const badInput = () => NextResponse.json({ error: "invalid input" }, { status: 400 });

/** The database plus a rate-limit check, or the response to send instead. */
export async function dbFor(req: Request, limit?: Limit): Promise<{ db: Db } | { res: NextResponse }> {
  let db: Db | null = null;
  try {
    db = await (getDb() ?? null);
  } catch (e) {
    console.error("database unavailable:", (e as Error).message);
  }
  if (!db) return { res: NextResponse.json({ error: "Group links aren't set up on this server." }, { status: 503 }) };
  if (limit) {
    const wait = await retryAfter(db, limit, clientId(req));
    if (wait) return { res: NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { "Retry-After": String(wait) } }) };
  }
  return { db };
}

/** Opportunistic cleanup, so expiry works without a cron job. Never fails the request. */
export function purgeSoon(db: Db) {
  purgeExpired(db).catch((e) => console.error("purge failed:", (e as Error).message));
}
