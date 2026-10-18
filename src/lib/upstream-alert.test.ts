import { test } from "node:test";
import assert from "node:assert/strict";
import { pgliteDb } from "./db.ts";
import { alertFailure, describeFailure, errorKind, resetAlertsForTest, type Failure } from "./upstream-alert.ts";

const f: Failure = { stage: "routing", provider: "openrouteservice", mode: "WALK", size: "4x23", ms: 20004, error: "timeout" };

test("error labels: timeouts and network failures are named, provider messages kept", () => {
  assert.equal(errorKind(new DOMException("The operation was aborted due to timeout", "TimeoutError")), "timeout");
  assert.equal(errorKind(new TypeError("fetch failed")), "network error");
  assert.equal(errorKind(new Error("ORS 503")), "ORS 503");
  assert.equal(errorKind(new SyntaxError(`Unexpected token '<', "<html>14.6" is not valid JSON`)), "unreadable response");
  assert.equal(errorKind("x".repeat(500)).length, 120);
});

test("the line says what failed and nothing about where anyone is", () => {
  assert.equal(describeFailure(f), "routing failed: openrouteservice WALK 4x23 after 20004 ms (timeout)");
});

test("one alert per provider and mode per hour, shared through the database", async () => {
  resetAlertsForTest();
  const db = await pgliteDb();
  const sent: string[] = [];
  const send = async (c: string) => void sent.push(c);
  const t0 = Date.parse("2026-10-18T10:00:00Z");
  assert.equal(await alertFailure(f, { db, send, now: t0 }), true);
  assert.equal(await alertFailure(f, { db, send, now: t0 + 60_000 }), false);
  assert.equal(await alertFailure({ ...f, mode: "DRIVE" }, { db, send, now: t0 + 60_000 }), true);
  // Another instance (empty memory) still sees the database's count.
  resetAlertsForTest();
  assert.equal(await alertFailure(f, { db, send, now: t0 + 120_000 }), false);
  assert.equal(await alertFailure(f, { db, send, now: t0 + 3600_001 }), true);
  assert.equal(sent.length, 3);
  assert.match(sent[0], /openrouteservice WALK 4x23/);
});

test("no database: the per-instance limit still holds; a failing webhook never throws", async () => {
  resetAlertsForTest();
  const sent: string[] = [];
  const send = async (c: string) => void sent.push(c);
  assert.equal(await alertFailure(f, { db: null, send, now: 0 }), true);
  assert.equal(await alertFailure(f, { db: null, send, now: 1000 }), false);
  resetAlertsForTest();
  const boom = async () => {
    throw new Error("discord down");
  };
  assert.equal(await alertFailure(f, { db: null, send: boom, now: 0 }), false);
  // A failed send doesn't use up the hour.
  assert.equal(await alertFailure(f, { db: null, send, now: 1000 }), true);
});

test("a failed send gives the hour back in the database too", async () => {
  resetAlertsForTest();
  const db = await pgliteDb();
  const sent: string[] = [];
  const send = async (c: string) => void sent.push(c);
  const boom = async () => {
    throw new Error("discord 429");
  };
  const t0 = Date.parse("2026-10-18T12:00:00Z");
  // A slow failing send: another instance's failure is turned away by the table before it gives up.
  let blocked: boolean | undefined;
  const slowBoom = async () => {
    resetAlertsForTest(); // stands in for the other instance's empty map
    blocked = await alertFailure(f, { db, send, now: t0 + 500 });
    await boom();
  };
  assert.equal(await alertFailure(f, { db, send: slowBoom, now: t0 }), false);
  assert.equal(blocked, false);
  assert.equal(await alertFailure(f, { db, send, now: t0 + 1000 }), true);
  assert.equal(sent.length, 1);
});
