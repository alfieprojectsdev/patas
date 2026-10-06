import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { isMemberToken, keyCheck, keyMatches, newMemberToken, openCell, sealCell, sha256hex } from "./seal.ts";

/**
 * Group links: create a group, let members join from their own phones, and
 * hand their cells to the ranking code in request scope only.
 *
 * Every call needs the group key K. A wrong key and a missing group give the
 * same NOT_FOUND, so a group id alone reveals nothing. No function here
 * returns a member's cell to a caller other than meet code on the server.
 */
export const MAX_MEMBERS = 10;
export const SEAL_HOURS = 48;

export type GroupError = "NOT_FOUND" | "ALIAS_TAKEN" | "GROUP_FULL";
export type Member = { alias: string; ready: boolean; you: boolean };

async function checkGroup(db: Db, groupId: string, k: string): Promise<{ expiresAt: string } | null> {
  const { rows } = await db.query<{ key_check: string | null; expires_at: Date | string }>(
    "select key_check, expires_at from groups where id = $1 and expires_at > now()",
    [groupId],
  );
  const g = rows[0];
  return g && keyMatches(k, g.key_check) ? { expiresAt: new Date(g.expires_at).toISOString() } : null;
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "23505";

/** Clear expired sealed cells, groups and rate-limit rows. Cheap; run opportunistically. */
export async function purgeExpired(db: Db): Promise<void> {
  await db.query("update members set sealed_cell = null, sealed_until = null where sealed_until < now()");
  await db.query("delete from groups where expires_at < now()");
  await db.query("delete from rate_limits where window_start < now() - interval '1 day'");
}

export async function createGroup(db: Db, k: string): Promise<{ groupId: string; expiresAt: string }> {
  const { rows } = await db.query<{ id: string; expires_at: Date | string }>(
    "insert into groups (key_check) values ($1) returning id, expires_at",
    [keyCheck(k)],
  );
  return { groupId: rows[0].id, expiresAt: new Date(rows[0].expires_at).toISOString() };
}

/**
 * Join, or update your own entry if `memberToken` is yours. The cell is
 * sealed before it touches the database. Returns a token that lets this
 * device change its landmark later.
 */
export async function joinGroup(
  db: Db,
  input: { groupId: string; k: string; alias: string; cell: string; memberToken?: string },
): Promise<{ ok: true; memberToken: string } | { ok: false; error: GroupError }> {
  const { groupId, k, alias, cell } = input;
  if (!(await checkGroup(db, groupId, k))) return { ok: false, error: "NOT_FOUND" };
  const sealedUntil = new Date(Date.now() + SEAL_HOURS * 3600_000);

  try {
    if (isMemberToken(input.memberToken)) {
      const tokenHash = sha256hex(input.memberToken);
      const { rows } = await db.query<{ id: string }>(
        "select id from members where group_id = $1 and token_hash = $2",
        [groupId, tokenHash],
      );
      if (rows[0]) {
        await db.query(
          "update members set alias = $1, sealed_cell = $2, sealed_until = $3 where id = $4",
          [alias, sealCell(k, groupId, rows[0].id, cell), sealedUntil, rows[0].id],
        );
        return { ok: true, memberToken: input.memberToken };
      }
    }

    const id = randomUUID(); // known before insert, so the seal can be bound to it
    const memberToken = newMemberToken();
    const { rows } = await db.query(
      `insert into members (id, group_id, alias, token_hash, sealed_cell, sealed_until)
       select $1, $2, $3, $4, $5, $6
       where (select count(*) from members where group_id = $2) < $7
       returning id`,
      [id, groupId, alias, sha256hex(memberToken), sealCell(k, groupId, id, cell), sealedUntil, MAX_MEMBERS],
    );
    return rows[0] ? { ok: true, memberToken } : { ok: false, error: "GROUP_FULL" };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "ALIAS_TAKEN" };
    throw e;
  }
}

/** Who's in, and whether their landmark is still sealed (usable). No cells. */
export async function groupStatus(
  db: Db,
  groupId: string,
  k: string,
  memberToken?: string,
): Promise<{ ok: true; members: Member[]; expiresAt: string } | { ok: false; error: GroupError }> {
  const g = await checkGroup(db, groupId, k);
  if (!g) return { ok: false, error: "NOT_FOUND" };
  const mine = isMemberToken(memberToken) ? sha256hex(memberToken) : null;
  const { rows } = await db.query<{ alias: string; ready: boolean; token_hash: string | null }>(
    `select alias, (sealed_cell is not null and sealed_until > now()) as ready, token_hash
     from members where group_id = $1 order by joined_at, alias`,
    [groupId],
  );
  return {
    ok: true,
    expiresAt: g.expiresAt,
    members: rows.map((r) => ({ alias: r.alias, ready: r.ready, you: mine != null && r.token_hash === mine })),
  };
}

/**
 * Members' cells, unsealed in memory for one ranking request. Server-side
 * only: never send the result to a client.
 */
export async function unsealOrigins(
  db: Db,
  groupId: string,
  k: string,
): Promise<{ ok: true; origins: { alias: string; cell: string }[] } | { ok: false; error: GroupError }> {
  if (!(await checkGroup(db, groupId, k))) return { ok: false, error: "NOT_FOUND" };
  const { rows } = await db.query<{ id: string; alias: string; sealed_cell: Uint8Array }>(
    `select id, alias, sealed_cell from members
     where group_id = $1 and sealed_cell is not null and sealed_until > now()
     order by joined_at, alias
     limit $2`, // the join-time cap can be overshot by simultaneous joins; never rank more
    [groupId, MAX_MEMBERS],
  );
  const origins = rows.flatMap((r) => {
    const cell = openCell(k, groupId, r.id, r.sealed_cell);
    return cell ? [{ alias: r.alias, cell }] : [];
  });
  return { ok: true, origins };
}
