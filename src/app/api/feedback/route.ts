import { NextResponse } from "next/server";
import { notifyFeedback, parseFeedback, saveFeedback } from "@/lib/feedback";
import { LIMITS } from "@/lib/rate-limit";
import { dbFor } from "@/lib/group-api";

export const runtime = "nodejs";

/**
 * POST /api/feedback  { kind?, message, contact?, page?, website? } → 201 { ok }
 * Open to everyone. `website` is a honeypot: humans never see it, so a
 * filled one means a bot, which gets a fake success.
 * PRIVACY: don't log the body; it's free text from minors.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.website) return NextResponse.json({ ok: true }, { status: 201 });
  const parsed = parseFeedback(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const got = await dbFor(req, LIMITS.feedback);
  if ("res" in got) {
    // dbFor's messages are written for group links; say what happened to the message instead.
    return got.res.status === 429
      ? NextResponse.json({ error: "Thanks! Please try again in an hour." }, { status: 429 })
      : NextResponse.json({ error: "Feedback can't be sent right now. Please try again later." }, { status: 503 });
  }
  await saveFeedback(got.db, parsed.value, req.headers.get("user-agent"));
  await notifyFeedback(parsed.value);
  return NextResponse.json({ ok: true }, { status: 201 });
}
