import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Database access. Production: Postgres via `pg` (DATABASE_URL, e.g.
 * Supabase's pooled connection string). Local dev without DATABASE_URL:
 * PGlite (Postgres compiled to WASM) persisted in .data/pglite, so the group
 * flow works with no setup. Tests use an in-memory PGlite.
 *
 * Server-only: never import from a client component.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run a multi-statement script (migrations). */
  exec(sql: string): Promise<void>;
}

export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Apply supabase/migrations/*.sql not yet recorded in schema_migrations, in order. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const name of readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    if (done.has(name)) continue;
    await db.exec(`begin;\n${readFileSync(join(dir, name), "utf8")}\ninsert into schema_migrations (name) values ('${name}');\ncommit;`);
    applied.push(name);
  }
  return applied;
}

/** PGlite-backed Db. `dataDir` undefined = in memory. Migrations applied. */
export async function pgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  const db: Db = {
    query: async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] }),
    exec: async (sql) => {
      await pg.exec(sql);
    },
  };
  await migrate(db);
  return db;
}

async function pgDb(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  // Serverless functions each hold their own pool; keep it small.
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  return {
    query: async (text, params) => ({ rows: (await pool.query(text, params)).rows }),
    // One dedicated connection, rolled back on failure, so a failed script
    // can't hand an aborted transaction back to the pool.
    exec: async (sql) => {
      const c = await pool.connect();
      try {
        await c.query(sql);
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

// One instance per server process; survives Next dev hot reloads.
const g = globalThis as unknown as { __patasDb?: Promise<Db> };

/** The app database, or null when none is configured (production without DATABASE_URL). */
export function getDb(): Promise<Db> | null {
  if (g.__patasDb) return g.__patasDb;
  const url = process.env.DATABASE_URL;
  if (url) g.__patasDb = pgDb(url);
  else if (process.env.NODE_ENV !== "production") g.__patasDb = pgliteDb(join(process.cwd(), ".data", "pglite"));
  else return null;
  g.__patasDb.catch(() => (g.__patasDb = undefined)); // retry on the next request
  return g.__patasDb;
}
