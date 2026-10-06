import type { Db } from "./db.ts";
import { sha256hex } from "./seal.ts";

/**
 * Fixed-window request counter in Postgres (works on serverless), adapted
 * from washboard's limiter. One upsert per request. Stores sha256 of the IP,
 * never the IP. Fails open: a database hiccup shouldn't block a group.
 */
export type Limit = { endpoint: string; max: number; windowMs: number };

export const LIMITS = {
  meet: { endpoint: "meet", max: 60, windowMs: 3600_000 }, // each call can spend ORS quota
  groupCreate: { endpoint: "group-create", max: 10, windowMs: 3600_000 },
  groupJoin: { endpoint: "group-join", max: 30, windowMs: 3600_000 },
} satisfies Record<string, Limit>;

export function clientId(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return sha256hex(`patas|${ip}`);
}

/** Seconds to wait if over the limit, else 0. */
export async function retryAfter(db: Db, limit: Limit, client: string, now = new Date()): Promise<number> {
  try {
    const windowStart = new Date(now.getTime() - limit.windowMs);
    const { rows } = await db.query<{ count: number; window_start: Date | string }>(
      `insert into rate_limits (endpoint, client, count, window_start) values ($1, $2, 1, $3)
       on conflict (endpoint, client) do update set
         count = case when rate_limits.window_start < $4 then 1 else rate_limits.count + 1 end,
         window_start = case when rate_limits.window_start < $4 then $3 else rate_limits.window_start end
       returning count, window_start`,
      [limit.endpoint, client, now, windowStart],
    );
    const { count, window_start } = rows[0];
    if (count <= limit.max) return 0;
    return Math.max(1, Math.ceil((new Date(window_start).getTime() + limit.windowMs - now.getTime()) / 1000));
  } catch (e) {
    console.error("rate limit check failed:", (e as Error).message);
    return 0;
  }
}
