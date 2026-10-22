import { test } from "node:test";
import assert from "node:assert/strict";
import { pgliteDb } from "./db.ts";
import { device, esc, listQuery, loadFeedback, PAGE_SIZE, parseFilter, renderPage } from "./feedback-view.ts";

const filter = (s: string) => parseFilter(new URLSearchParams(s));

test("parseFilter: unknown kind, junk before and long q are dropped or capped", () => {
  assert.deepEqual(filter(""), { kind: null, q: "", before: null });
  assert.deepEqual(filter("kind=idea&q=%20jeep%20&before=42"), { kind: "idea", q: "jeep", before: 42 });
  assert.deepEqual(filter("kind=drop table&before=-1"), { kind: null, q: "", before: null });
  assert.equal(filter("before=1e3x").before, null);
  assert.equal(filter(`q=${"x".repeat(500)}`).q.length, 200);
});

test("listQuery: user text only ever travels as a parameter", () => {
  const q = listQuery(filter("kind=problem&q=' or 1=1 --&before=9"));
  assert.ok(!q.text.includes("or 1=1"));
  assert.deepEqual(q.params, ["problem", "' or 1=1 --", 9]);
  assert.match(q.text, /limit 101$/);
});

test("esc and render: message text can't inject markup", () => {
  assert.equal(esc(`<script>"&'`), "&lt;script&gt;&quot;&amp;&#39;");
  const html = renderPage(
    {
      rows: [{ id: 1, kind: "idea", message: "<img src=x onerror=alert(1)>", contact: "<b>me</b>", page: "/", user_agent: null, created_at: new Date() }],
      more: false,
      counts: { problem: 0, idea: 1, other: 0 },
      week: 1,
    },
    filter(`q="><script>`),
    "database: local PGlite",
  );
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<b>me</b>"));
  assert.ok(!html.includes(`"><script>`));
});

test("device: a short label, not the whole user agent", () => {
  assert.equal(device("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36"), "Chrome on Android");
  assert.equal(device("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) [FBAN/FBIOS;FBAV/480.0]"), "Facebook in-app on iOS");
  assert.equal(device("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 CriOS/129.0 Mobile/15E148 Safari/604.1"), "Chrome on iOS");
  assert.equal(device("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 EdgA/129.0"), "Edge on Android");
  assert.equal(device(null), "");
});

test("loadFeedback: filters, search, counts and paging against PGlite", async () => {
  const db = await pgliteDb();
  await db.query("insert into feedback (kind, message, contact) values ('problem', 'Map is blank on Jeep phone', null), ('idea', 'add jeepney fares', 'ig @someone'), ('other', 'thanks', null)");
  const all = await loadFeedback(db, filter(""));
  assert.deepEqual(all.counts, { problem: 1, idea: 1, other: 1 });
  assert.equal(all.week, 3);
  assert.deepEqual(all.rows.map((r) => r.kind), ["other", "idea", "problem"]);
  assert.ok(all.rows[0].created_at instanceof Date);

  assert.deepEqual((await loadFeedback(db, filter("q=JEEP"))).rows.map((r) => r.kind), ["idea", "problem"]);
  assert.deepEqual((await loadFeedback(db, filter("q=%40someone"))).rows.map((r) => r.kind), ["idea"]);
  assert.deepEqual((await loadFeedback(db, filter("kind=problem&q=jeep"))).rows.length, 1);
  assert.equal((await loadFeedback(db, filter("q=%25"))).rows.length, 0); // % is literal, not a wildcard

  await db.query(`insert into feedback (message) select 'row ' || g from generate_series(1, ${PAGE_SIZE}) g`);
  const first = await loadFeedback(db, filter(""));
  assert.equal(first.rows.length, PAGE_SIZE);
  assert.ok(first.more);
  const next = await loadFeedback(db, filter(`before=${first.rows.at(-1)!.id}`));
  assert.equal(next.rows.length, 3);
  assert.ok(!next.more);
});
