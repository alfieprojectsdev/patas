"use client";

import { useRef, useState } from "react";
import { trackEvent } from "./analytics";

/** Footer "Feedback" link → a small dialog that posts to /api/feedback. */
export default function FeedbackButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("problem");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const message = String(data.get("message") ?? "");
    if (!message.trim()) return setStatus({ text: "Please write a message.", ok: false });
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: data.get("kind"),
          message,
          contact: data.get("contact"),
          page: window.location.pathname, // the server strips it further; never the #key
          website: data.get("website"),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setStatus({ text: body.error ?? "Couldn't send. Please try again.", ok: false });
      trackEvent("feedback-sent", "Feedback sent");
      form.reset();
      setKind("problem");
      setStatus({ text: "Thanks, it was sent. Every message gets read.", ok: true });
    } catch {
      setStatus({ text: "Couldn't reach Patas. Check your connection.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="link"
        onClick={() => {
          setStatus(null);
          dialog.current?.showModal();
        }}
      >
        Feedback
      </button>
      <dialog ref={dialog} className="feedback sheet" aria-labelledby="fb-title">
        <form onSubmit={submit}>
          <div className="sheet-head">
            <h2 id="fb-title">Send feedback</h2>
            <button type="button" className="close" aria-label="Close" onClick={() => dialog.current?.close()}>
              ×
            </button>
          </div>
          <fieldset className="pills">
            <legend className="sr-only">Kind</legend>
            {[
              ["problem", "Something's wrong"],
              ["idea", "An idea"],
              ["other", "Other"],
            ].map(([value, label]) => (
              <label key={value} className={kind === value ? "on" : undefined}>
                <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Message</span>
            <textarea name="message" rows={5} maxLength={2000} required />
          </label>
          <p className="hint">Please don't include your home address, phone number or anyone's full name.</p>
          <label className="field">
            <span>How to reach you (optional)</span>
            <input name="contact" maxLength={200} placeholder="Leave blank if you don't need a reply" />
          </label>
          {/* Honeypot: hidden from people, filled in by bots. */}
          <input name="website" tabIndex={-1} autoComplete="off" className="honeypot" aria-hidden="true" />
          {status && (
            <p className={status.ok ? "note" : "error"} role="status">
              {status.text}
            </p>
          )}
          <div className="fb-actions">
            <button type="submit" className="btn-accent" disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
