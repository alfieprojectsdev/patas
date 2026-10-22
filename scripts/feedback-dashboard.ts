/**
 * Read-only feedback dashboard, on this machine only.
 *
 *   npm run feedback                  local PGlite (.data/pglite); stop `next dev` first
 *   DATABASE_URL=... npm run feedback production (Neon), connection string fetched per session
 *
 * Opens http://127.0.0.1:3200 (PORT overrides). Never deploy this: feedback can
 * carry a contact someone left, which is personal data, and the page has no login.
 * It listens on 127.0.0.1 only and refuses any other Host header, so a web page
 * can't reach it through DNS rebinding.
 */
import { createServer } from "node:http";
import { getDb } from "../src/lib/db.ts";
import { loadFeedback, parseFilter, renderPage } from "../src/lib/feedback-view.ts";

const url = process.env.DATABASE_URL;
if (url === "") throw new Error("DATABASE_URL is set but empty; refusing to fall back to the local database");
const source = url ? `database: ${new URL(url).host}` : "database: local PGlite (.data/pglite)";
console.log(source);
const db = await getDb();
if (!db) throw new Error("DATABASE_URL is not set");

const port = Number(process.env.PORT) || 3200;
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

createServer(async (req, res) => {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  const u = new URL(req.url ?? "/", `http://${hosts.values().next().value}`);
  if (!hosts.has(req.headers.host ?? "") || req.method !== "GET" || u.pathname !== "/") {
    res.writeHead(404, headers).end("Not found");
    return;
  }
  try {
    const f = parseFilter(u.searchParams);
    res.writeHead(200, headers).end(renderPage(await loadFeedback(db, f), f, source));
  } catch (e) {
    console.error("query failed:", (e as Error).message);
    res.writeHead(500, headers).end("Query failed; see the terminal.");
  }
}).listen(port, "127.0.0.1", () => console.log(`feedback: http://127.0.0.1:${port}`));
