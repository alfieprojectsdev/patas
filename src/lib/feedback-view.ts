import type { Db } from "./db.ts";
import { FEEDBACK_DAYS, FEEDBACK_KINDS, type FeedbackKind } from "./feedback.ts";

/**
 * The read-only feedback dashboard (`npm run feedback`, scripts/feedback-dashboard.ts).
 * Runs on the owner's machine only, never deployed: rows can hold a contact
 * (an email or handle someone left so we can reply), which is personal data.
 * Only SELECTs here.
 */
export type FeedbackFilter = { kind: FeedbackKind | null; q: string; before: number | null };
export type FeedbackRow = {
  id: number;
  kind: FeedbackKind;
  message: string;
  contact: string | null;
  page: string | null;
  user_agent: string | null;
  created_at: Date;
};
export const PAGE_SIZE = 100;

export function parseFilter(params: URLSearchParams): FeedbackFilter {
  const kind = params.get("kind");
  const before = Number(params.get("before"));
  return {
    kind: FEEDBACK_KINDS.includes(kind as FeedbackKind) ? (kind as FeedbackKind) : null,
    q: (params.get("q") ?? "").trim().slice(0, 200),
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
  };
}

/** Newest first, PAGE_SIZE + 1 rows (the extra one says there's an older page). */
export function listQuery(f: FeedbackFilter): { text: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.kind) {
    params.push(f.kind);
    where.push(`kind = $${params.length}`);
  }
  if (f.q) {
    params.push(f.q.toLowerCase());
    const p = `$${params.length}`;
    where.push(`(position(${p} in lower(message)) > 0 or position(${p} in lower(coalesce(contact, ''))) > 0 or position(${p} in lower(coalesce(page, ''))) > 0)`);
  }
  if (f.before) {
    params.push(f.before);
    where.push(`id < $${params.length}`);
  }
  const text = `select id, kind, message, contact, page, user_agent, created_at from feedback${where.length ? ` where ${where.join(" and ")}` : ""} order by id desc limit ${PAGE_SIZE + 1}`;
  return { text, params };
}

export type FeedbackView = { rows: FeedbackRow[]; more: boolean; counts: Record<FeedbackKind, number>; week: number };

export async function loadFeedback(db: Db, f: FeedbackFilter): Promise<FeedbackView> {
  const q = listQuery(f);
  const [list, byKind] = await Promise.all([
    db.query<FeedbackRow>(q.text, q.params),
    db.query<{ kind: FeedbackKind; n: number; week: number }>(
      "select kind, count(*)::int as n, (count(*) filter (where created_at > now() - interval '7 days'))::int as week from feedback group by kind",
    ),
  ]);
  const counts = { problem: 0, idea: 0, other: 0 } as Record<FeedbackKind, number>;
  let week = 0;
  for (const r of byKind.rows) {
    counts[r.kind] = r.n;
    week += r.week;
  }
  const rows = list.rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, created_at: new Date(r.created_at) }));
  return { rows, more: list.rows.length > PAGE_SIZE, counts, week };
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const LABEL: Record<FeedbackKind, string> = { problem: "Problem", idea: "Idea", other: "Other" };
const when = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

/** A rough device label from the user agent, enough to tell a phone from a laptop. */
export function device(ua: string | null): string {
  if (!ua) return "";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /FBAN|FBAV|FB_IAB/.test(ua) ? "Facebook in-app" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" on ") || ua.slice(0, 60);
}

function href(f: FeedbackFilter, change: Partial<FeedbackFilter>): string {
  const g = { ...f, ...change };
  const p = new URLSearchParams();
  if (g.kind) p.set("kind", g.kind);
  if (g.q) p.set("q", g.q);
  if (g.before) p.set("before", String(g.before));
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

export function renderPage(v: FeedbackView, f: FeedbackFilter, source: string): string {
  const total = FEEDBACK_KINDS.reduce((n, k) => n + v.counts[k], 0);
  const tabs = [
    `<a class="${f.kind ? "" : "on"}" href="${esc(href(f, { kind: null, before: null }))}">All <b>${total}</b></a>`,
    ...FEEDBACK_KINDS.map(
      (k) => `<a class="${f.kind === k ? "on" : ""}" href="${esc(href(f, { kind: k, before: null }))}">${LABEL[k]} <b>${v.counts[k]}</b></a>`,
    ),
  ].join("");
  const items = v.rows
    .map(
      (r) => `<article class="${r.kind}">
  <header><span class="kind">${LABEL[r.kind]}</span><time datetime="${r.created_at.toISOString()}">${esc(when.format(r.created_at))}</time>${r.page ? `<code>${esc(r.page)}</code>` : ""}<span class="ua" title="${esc(r.user_agent ?? "")}">${esc(device(r.user_agent))}</span><span class="id">#${r.id}</span></header>
  <p>${esc(r.message)}</p>
  ${r.contact ? `<p class="contact">Reply to: ${esc(r.contact)}</p>` : ""}
</article>`,
    )
    .join("\n");
  const empty = f.q || f.kind ? "Nothing matches." : "No feedback yet.";
  const older = v.more ? `<p class="more"><a href="${esc(href(f, { before: v.rows[v.rows.length - 1].id }))}">Older</a></p>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Patas feedback</title>
<style>
:root { --bg: #fbf8f3; --card: #fff; --ink: #1f1b16; --muted: #6b6258; --line: #e6dfd5; --problem: #b3261e; --idea: #2e6b3f; --other: #5a5a8a; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #171512; --card: #211e1a; --ink: #eee7dd; --muted: #a39a8f; --line: #38322b; --problem: #f2a59f; --idea: #9fd6ac; --other: #b9b9e6; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color: var(--muted); margin: 0 0 16px; font-size: 13px; }
nav { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
nav a { padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; color: inherit; text-decoration: none; font-size: 14px; }
nav a.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
form { display: flex; gap: 6px; margin-bottom: 16px; }
input[type=search] { flex: 1; min-width: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: inherit; font: inherit; }
button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: inherit; font: inherit; cursor: pointer; }
article { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--other); border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
article.problem { border-left-color: var(--problem); } article.idea { border-left-color: var(--idea); }
article header { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; color: var(--muted); font-size: 13px; }
.kind { font-weight: 600; color: var(--ink); } .id { margin-left: auto; }
article p { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.contact { color: var(--muted); font-size: 14px; }
code { font-size: 12px; }
.more { text-align: center; }
</style></head>
<body><main>
<h1>Patas feedback</h1>
<p class="sub">${esc(source)} · ${v.week} in the last 7 days · rows are deleted after ${FEEDBACK_DAYS} days · times in Manila</p>
<nav>${tabs}</nav>
<form method="get" action="/">${f.kind ? `<input type="hidden" name="kind" value="${f.kind}">` : ""}<input type="search" name="q" value="${esc(f.q)}" placeholder="Search messages, contacts, pages" aria-label="Search"><button>Search</button>${f.q ? `<a href="${esc(href(f, { q: "", before: null }))}">Clear</a>` : ""}</form>
${items || `<p>${empty}</p>`}
${older}
</main></body></html>`;
}
