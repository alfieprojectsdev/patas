"use client";

import { useState } from "react";
import { trackEvent } from "./analytics";

/** base64url of 32 random bytes: the group key K, made here and never sent in a URL. */
function newGroupKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function StartGroup() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const k = newGroupKey();
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ k }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't create the group.");
      trackEvent("group-created", "Group link created");
      window.location.assign(`/g/${data.groupId}#k=${k}`);
    } catch (e) {
      setError((e as Error).message || "Couldn't reach Patas. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <>
      <section className="start-group" aria-labelledby="sg">
        <h2 id="sg">Everyone on their own phone?</h2>
        <p className="hint">
          Make a group link and send it to your group chat. Each person adds their own landmark, and nobody sees anyone
          else's.
        </p>
        <button type="button" className="secondary" disabled={busy} onClick={start}>
          {busy ? "Making a link…" : "Create a group link"}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <p className="hint or">Or plan for everyone on this phone:</p>
    </>
  );
}
