import { test } from "node:test";
import assert from "node:assert/strict";
import { pgliteDb, type Db } from "./db.ts";
import { cleanPage, parseFeedback, saveFeedback } from "./feedback.ts";
import { purgeExpired } from "./groups.ts";

let dbPromise: Promise<Db> | null = null;
const db = () => (dbPromise ??= pgliteDb());

test("page: path only, group id blanked, never the #key", () => {
  assert.equal(cleanPage("/g/6d1f0a4e-0000-4000-8000-000000000001#k=secret"), "/g/_");
  assert.equal(cleanPage("/privacy?x=1"), "/privacy");
  assert.equal(cleanPage("https://evil.example/"), null);
  assert.equal(cleanPage(42), null);
});

test("parseFeedback: trims, defaults kind, rejects empty and oversized", () => {
  const ok = parseFeedback({ kind: "idea", message: "  add jeepney times  ", contact: "  ", page: "/" });
  assert.deepEqual(ok, { value: { kind: "idea", message: "add jeepney times", contact: null, page: "/" } });
  const r = parseFeedback({ kind: "rant", message: "x" });
  assert.ok("value" in r && r.value.kind === "other");
  assert.ok("error" in parseFeedback({ message: "   " }));
  assert.ok("error" in parseFeedback({ message: "x".repeat(2001) }));
  assert.ok("error" in parseFeedback({ message: "x", contact: "y".repeat(201) }));
  assert.ok("error" in parseFeedback(null));
});

test("feedback is stored, and purged after 180 days", async () => {
  const d = await db();
  const r = parseFeedback({ kind: "problem", message: "map is blank", page: "/g/abc#k=secret" });
  assert.ok("value" in r);
  await saveFeedback(d, r.value, "Mozilla/5.0 test");
  const { rows } = await d.query<{ page: string; user_agent: string }>("select page, user_agent from feedback order by id desc limit 1");
  assert.deepEqual(rows[0], { page: "/g/_", user_agent: "Mozilla/5.0 test" });

  await d.query("update feedback set created_at = now() - interval '181 days'");
  await purgeExpired(d);
  const { rows: left } = await d.query<{ n: number }>("select count(*)::int as n from feedback");
  assert.equal(left[0].n, 0);
});
