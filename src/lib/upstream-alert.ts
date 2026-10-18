import { getDb, type Db } from "./db.ts";
import { retryAfter, type Limit } from "./rate-limit.ts";
import { postWebhook } from "./webhook.ts";

/**
 * When a search fails upstream (openrouteservice down, candidate snapshot
 * missing), log a line that says what failed, and ping the owner.
 *
 * Privacy: a failure is described only by stage, provider, mode, matrix size
 * ("4x23"), elapsed time and a short error label. Never coordinates, cells,
 * landmarks, or request or response bodies.
 *
 * Alerts go to ALERT_WEBHOOK_URL, else FEEDBACK_WEBHOOK_URL (a Discord
 * channel webhook), at most one per provider and mode per hour. The limit is
 * kept in the rate_limits table so all serverless instances share it, plus a
 * per-instance copy in case the database is down too (the table check fails open).
 */
export type Failure = {
  stage: "candidates" | "routing" | "table";
  provider: string;
  mode: string;
  size: string;
  ms: number;
  error: string;
};

/** Pure: a short label for an error. Our own provider errors are already short and payload-free ("ORS 503"). */
export function errorKind(e: unknown): string {
  const err = e instanceof Error ? e : null;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
  if (err?.name === "TypeError" && /fetch failed/i.test(err.message)) return "network error";
  // JSON.parse messages quote part of the response body, which may hold coordinates.
  if (err?.name === "SyntaxError") return "unreadable response";
  return (err?.message ?? String(e)).slice(0, 120);
}

/** Pure: the log and alert line. */
export const describeFailure = (f: Failure) =>
  `${f.stage} failed: ${f.provider} ${f.mode} ${f.size} after ${f.ms} ms (${f.error})`;

export const ALERT_LIMIT: Limit = { endpoint: "upstream-alert", max: 1, windowMs: 3600_000 };
const sentHere = new Map<string, number>();

type Deps = { db?: Db | null; send?: (content: string) => Promise<void>; now?: number };

/** True if this failure should be sent now; records the send. */
async function due(key: string, db: Db | null, now: number): Promise<boolean> {
  const last = sentHere.get(key);
  if (last !== undefined && now - last < ALERT_LIMIT.windowMs) return false;
  if (db && (await retryAfter(db, ALERT_LIMIT, key, new Date(now)))) return false;
  sentHere.set(key, now);
  return true;
}

/**
 * Undo `due` after a failed send, so the next failure can try again. Deletes
 * the row instead of decrementing it, because failures that were turned away
 * while the send was in flight also bumped the count.
 */
async function release(key: string, db: Db | null): Promise<void> {
  sentHere.delete(key);
  if (db) await db.query("delete from rate_limits where endpoint = $1 and client = $2", [ALERT_LIMIT.endpoint, key]);
}

/** Never throws. Sends nothing without a webhook URL (or `send`). */
export async function alertFailure(f: Failure, deps: Deps = {}): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL || process.env.FEEDBACK_WEBHOOK_URL;
  const send = deps.send ?? (url ? (c: string) => postWebhook(url, c) : null);
  if (!send) return false;
  const key = `${f.provider}|${f.mode}`;
  let db: Db | null = null;
  let claimed = false;
  try {
    db = deps.db !== undefined ? deps.db : await (getDb()?.catch(() => null) ?? null);
    if (!(await due(key, db, deps.now ?? Date.now()))) return false;
    claimed = true;
    await send(`**Patas search ${describeFailure(f)}**\nAt most one alert per provider and mode per hour.`);
    return true;
  } catch (e) {
    console.error("alert webhook failed:", (e as Error).message);
    if (claimed) await release(key, db).catch(() => {});
    return false;
  }
}

/** Tests only. */
export const resetAlertsForTest = () => sentHere.clear();
