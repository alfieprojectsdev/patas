import type { Db } from "./db.ts";

/**
 * The Feedback button, adapted from carpool-app's lib/feedback.js.
 * Submissions are stored in `feedback`; FEEDBACK_WEBHOOK_URL (a Discord
 * channel webhook) optionally pings the owner too.
 *
 * Privacy (users are minors): the page is stored as a bare path, without
 * ?query or #fragment (group links carry their key there) and with group
 * ids blanked. Rows are deleted after FEEDBACK_DAYS.
 */
export const FEEDBACK_KINDS = ["problem", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type Feedback = { kind: FeedbackKind; message: string; contact: string | null; page: string | null };
export const FEEDBACK_DAYS = 180;

/** Path only: no query, no fragment, group id blanked. */
export function cleanPage(page: unknown): string | null {
  if (typeof page !== "string" || !page.startsWith("/")) return null;
  return page.split(/[?#]/)[0].replace(/^\/g\/[^/]+/, "/g/_").slice(0, 300);
}

/** Pure validation. Returns the value to store, or an error message for the user. */
export function parseFeedback(body: unknown): { value: Feedback } | { error: string } {
  const { kind, message, contact, page } = (body ?? {}) as Record<string, unknown>;
  if (typeof message !== "string" || message.trim() === "") return { error: "Please write a message." };
  if (message.trim().length > 2000) return { error: "Please keep it under 2,000 characters." };
  if (contact != null && (typeof contact !== "string" || contact.length > 200)) {
    return { error: "Contact must be under 200 characters." };
  }
  return {
    value: {
      kind: FEEDBACK_KINDS.includes(kind as FeedbackKind) ? (kind as FeedbackKind) : "other",
      message: message.trim(),
      contact: typeof contact === "string" && contact.trim() ? contact.trim() : null,
      page: cleanPage(page),
    },
  };
}

export async function saveFeedback(db: Db, f: Feedback, userAgent: string | null): Promise<void> {
  await db.query("insert into feedback (kind, message, contact, page, user_agent) values ($1, $2, $3, $4, $5)", [
    f.kind,
    f.message,
    f.contact,
    f.page,
    userAgent ? userAgent.slice(0, 300) : null,
  ]);
}

/** Optional Discord ping. Never throws; user text can't mention anyone. */
export async function notifyFeedback(f: Feedback): Promise<void> {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  if (!url) return;
  const lines = [`**Patas feedback** (${f.kind}${f.page ? `, ${f.page}` : ""})`, f.message, f.contact ? `Contact: ${f.contact}` : "No contact left"];
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: lines.join("\n").slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.error("feedback webhook failed:", (e as Error).message);
  }
}
