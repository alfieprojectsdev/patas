import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { migrate, pgliteDb, type Db } from "./db.ts";
import { keyCheck, keyMatches, openCell, sealCell } from "./seal.ts";
import { MAX_MEMBERS, createGroup, groupStatus, joinGroup, purgeExpired, unsealOrigins } from "./groups.ts";
import { retryAfter } from "./rate-limit.ts";

const newKey = () => randomBytes(32).toString("base64url");
const CELL_A = "89694ec2c87ffff"; // SM North
const CELL_B = "89694ec74dbffff"; // Miriam College
const GID = "6d1f0a4e-0000-4000-8000-000000000001";

let dbPromise: Promise<Db> | null = null;
const db = () => (dbPromise ??= pgliteDb());

test("seal: round trip; wrong key, wrong member or tampered bytes fail", () => {
  const k = newKey();
  const s = sealCell(k, GID, "m1", CELL_A);
  assert.equal(openCell(k, GID, "m1", s), CELL_A);
  assert.equal(openCell(newKey(), GID, "m1", s), null);
  assert.equal(openCell(k, GID, "m2", s), null); // rows can't be swapped between members
  const bad = Buffer.from(s);
  bad[bad.length - 1] ^= 1;
  assert.equal(openCell(k, GID, "m1", bad), null);
  assert.ok(!s.toString("latin1").includes(CELL_A));
});

test("keyMatches: right key only; malformed input rejected", () => {
  const k = newKey();
  assert.ok(keyMatches(k, keyCheck(k)));
  assert.equal(keyMatches(newKey(), keyCheck(k)), false);
  assert.equal(keyMatches("short", keyCheck(k)), false);
  assert.equal(keyMatches(k, null), false);
});

test("group flow: join, status, unseal; database holds no plaintext cell", async () => {
  const d = await db();
  const k = newKey();
  const { groupId } = await createGroup(d, k);

  const bea = await joinGroup(d, { groupId, k, alias: "Bea", cell: CELL_A });
  const jun = await joinGroup(d, { groupId, k, alias: "Jun", cell: CELL_B });
  assert.ok(bea.ok && jun.ok);

  const st = await groupStatus(d, groupId, k, bea.memberToken);
  assert.ok(st.ok);
  assert.deepEqual(st.members, [
    { alias: "Bea", ready: true, you: true },
    { alias: "Jun", ready: true, you: false },
  ]);

  const un = await unsealOrigins(d, groupId, k);
  assert.ok(un.ok);
  assert.deepEqual(un.origins, [{ alias: "Bea", cell: CELL_A }, { alias: "Jun", cell: CELL_B }]);

  const { rows } = await d.query<{ dump: string }>("select string_agg(m::text, '|') as dump from members m where group_id = $1", [groupId]);
  assert.ok(!rows[0].dump.includes(CELL_A) && !rows[0].dump.includes(CELL_B));
  const { rows: g } = await d.query<{ dump: string }>("select g::text as dump from groups g where id = $1", [groupId]);
  assert.ok(!g[0].dump.includes(k));
});

test("wrong key or unknown group: same NOT_FOUND, nothing revealed", async () => {
  const d = await db();
  const k = newKey();
  const { groupId } = await createGroup(d, k);
  await joinGroup(d, { groupId, k, alias: "Bea", cell: CELL_A });
  for (const r of [
    await groupStatus(d, groupId, newKey()),
    await unsealOrigins(d, groupId, newKey()),
    await joinGroup(d, { groupId, k: newKey(), alias: "Eve", cell: CELL_B }),
    await groupStatus(d, "6d1f0a4e-0000-4000-8000-0000000000ff", k),
  ]) {
    assert.deepEqual(r, { ok: false, error: "NOT_FOUND" });
  }
});

test("member token updates your own entry; duplicate nickname refused", async () => {
  const d = await db();
  const k = newKey();
  const { groupId } = await createGroup(d, k);
  const first = await joinGroup(d, { groupId, k, alias: "Bea", cell: CELL_A });
  assert.ok(first.ok);
  const again = await joinGroup(d, { groupId, k, alias: "Bea B.", cell: CELL_B, memberToken: first.memberToken });
  assert.ok(again.ok);
  const un = await unsealOrigins(d, groupId, k);
  assert.ok(un.ok);
  assert.deepEqual(un.origins, [{ alias: "Bea B.", cell: CELL_B }]);
  assert.deepEqual(await joinGroup(d, { groupId, k, alias: "Bea B.", cell: CELL_A }), { ok: false, error: "ALIAS_TAKEN" });
});

test(`group is capped at ${MAX_MEMBERS} members`, async () => {
  const d = await db();
  const k = newKey();
  const { groupId } = await createGroup(d, k);
  for (let i = 0; i < MAX_MEMBERS; i++) assert.ok((await joinGroup(d, { groupId, k, alias: `m${i}`, cell: CELL_A })).ok);
  assert.deepEqual(await joinGroup(d, { groupId, k, alias: "extra", cell: CELL_A }), { ok: false, error: "GROUP_FULL" });
});

test("expired seals stop counting and get cleared; expired groups deleted", async () => {
  const d = await db();
  const k = newKey();
  const { groupId } = await createGroup(d, k);
  await joinGroup(d, { groupId, k, alias: "Bea", cell: CELL_A });
  await d.query("update members set sealed_until = now() - interval '1 minute' where group_id = $1", [groupId]);
  const st = await groupStatus(d, groupId, k);
  assert.ok(st.ok && st.members[0].ready === false);
  const un = await unsealOrigins(d, groupId, k);
  assert.ok(un.ok && un.origins.length === 0);

  await purgeExpired(d);
  const { rows } = await d.query<{ n: number }>("select count(*)::int as n from members where group_id = $1 and sealed_cell is not null", [groupId]);
  assert.equal(rows[0].n, 0);

  await d.query("update groups set expires_at = now() - interval '1 minute' where id = $1", [groupId]);
  await purgeExpired(d);
  const { rows: left } = await d.query<{ n: number }>("select count(*)::int as n from members where group_id = $1", [groupId]);
  assert.equal(left[0].n, 0); // members cascade with the group
});

test("rate limit: allows max per window, then asks to wait; new window resets", async () => {
  const d = await db();
  const limit = { endpoint: `t-${Math.random()}`, max: 2, windowMs: 60_000 };
  const t0 = new Date("2026-10-06T00:00:00Z");
  assert.equal(await retryAfter(d, limit, "c1", t0), 0);
  assert.equal(await retryAfter(d, limit, "c1", t0), 0);
  assert.equal(await retryAfter(d, limit, "c1", new Date(t0.getTime() + 10_000)), 50);
  assert.equal(await retryAfter(d, limit, "c2", t0), 0); // per client
  assert.equal(await retryAfter(d, limit, "c1", new Date(t0.getTime() + 61_000)), 0);
});

test("migrations are recorded and not re-applied", async () => {
  const d = await db();
  assert.deepEqual(await migrate(d), []);
});
