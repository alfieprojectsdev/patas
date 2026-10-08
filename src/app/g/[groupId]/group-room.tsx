"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LandmarkPicker, { type Landmark } from "../../landmark-picker";
import { ModePicker, ResultsList, ResultsScreen, type Mode, type Result, type ResultMember } from "../../results";
import { initialOf, MemberHex, useMemberColors } from "../../member-colors";
import { useHashParam } from "../../use-hash-param";
import { trackEvent } from "../../analytics";

/**
 * One group, each member on their own phone. The group key K comes from the
 * link's #fragment and only ever leaves this page in POST bodies.
 *
 * This device remembers its member token (localStorage) so it can change its
 * own landmark later. It never stores a landmark: other members' cells never
 * reach this page, and your own is only kept in memory to draw on the map.
 */
type Status = { members: { alias: string; ready: boolean; you: boolean }[]; expiresAt: string };

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { res, data: await res.json().catch(() => ({})) };
};

function useMemberToken(groupId: string): [string | undefined, (t: string) => void] {
  const key = `patas:member:${groupId}`;
  const [token, setToken] = useState<string | undefined>();
  useEffect(() => {
    try {
      setToken(localStorage.getItem(key) ?? undefined);
    } catch {
      /* storage blocked: this device just can't edit its entry later */
    }
  }, [key]);
  const save = useCallback(
    (t: string) => {
      setToken(t);
      try {
        localStorage.setItem(key, t);
      } catch {}
    },
    [key],
  );
  return [token, save];
}

function GroupHeader() {
  return (
    <header className="site-header">
      <a href="/" className="brand">
        <img src="/icons/icon.svg" width={28} height={28} alt="" />
        <span className="wordmark">Patas</span>
      </a>
      <p className="lede">Find a fair place to meet, so nobody gets stuck with the long commute.</p>
    </header>
  );
}

export default function GroupRoom({ groupId }: { groupId: string }) {
  const k = useHashParam("k");
  const [memberToken, saveToken] = useMemberToken(groupId);
  const [status, setStatus] = useState<Status | null>(null);
  const [linkError, setLinkError] = useState("");
  const [alias, setAlias] = useState("");
  const [landmark, setLandmark] = useState<Landmark | null>(null);
  const [editing, setEditing] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [mode, setMode] = useState<Mode>("DRIVE");
  const [results, setResults] = useState<Result[] | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const colorIndex = useMemberColors();
  // Read after mount, not during render, so hydration matches the server.
  const [noKey, setNoKey] = useState(false);
  useEffect(() => setNoKey(!new URLSearchParams(window.location.hash.slice(1)).get("k")), []);

  const refresh = useCallback(async () => {
    if (!k) return;
    try {
      const { res, data } = await post(`/api/groups/${groupId}`, { k, memberToken });
      if (res.ok) {
        setStatus(data);
        setLinkError("");
      } else setLinkError(data.error ?? "Couldn't open this group.");
    } catch {
      /* offline: keep what we have */
    }
  }, [groupId, k, memberToken]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const me = status?.members.find((m) => m.you);
  const readyCount = status?.members.filter((m) => m.ready).length ?? 0;
  const showForm = !me || editing || !me.ready;
  const indexOf = (a: string) => Math.max(0, status?.members.findIndex((m) => m.alias === a) ?? 0);
  const memberOf = (a: string): ResultMember => ({ name: a, c: colorIndex(indexOf(a)), initial: initialOf(a) });

  async function join() {
    if (!k || !landmark) return;
    setJoining(true);
    setJoinError("");
    try {
      const { res, data } = await post(`/api/groups/${groupId}/join`, {
        k,
        alias: alias.trim() || me?.alias,
        cell: landmark.cell,
        memberToken,
      });
      if (!res.ok) return setJoinError(data.error ?? "Couldn't join.");
      trackEvent(me ? "group-landmark-changed" : "group-joined", me ? "Group: landmark changed" : "Group: member joined");
      if (data.memberToken === memberToken) await refresh();
      else saveToken(data.memberToken); // new token → refresh() reruns
      setEditing(false);
      setResults(null);
    } catch {
      setJoinError("Couldn't reach Patas. Check your connection.");
    } finally {
      setJoining(false);
    }
  }

  async function findSpots() {
    if (!k) return;
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const { res, data } = await post(`/api/groups/${groupId}/meet`, { k, mode });
      if (!res.ok) {
        setError(res.status === 502 ? "Couldn't get travel times right now. Try again in a minute." : data.error ?? "Something went wrong.");
        return;
      }
      setResults(data.results);
      trackEvent(`group-search-${mode.toLowerCase()}`, `Search, group link (${mode})`);
      setSelected(data.results[0]?.venueId ?? null);
      setSource(data.source);
      setShowResults(true);
      window.scrollTo(0, 0);
    } catch {
      setError("Couldn't reach Patas. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const venueName = (r: Result) => (r.venueId.startsWith("member:") ? `Near ${r.venueId.slice(7)}'s landmark` : r.name);
  // Only your own area is drawn: other members' landmarks never reach this page.
  const mine = useMemo(() => {
    if (!me || !landmark || editing) return null;
    const c = colorIndex(indexOf(me.alias));
    return { name: me.alias, c, initial: initialOf(me.alias), hex: landmark.hex };
  }, [me?.alias, landmark, editing, colorIndex, status]);
  const mapMembers = useMemo(() => (mine ? [{ initial: mine.initial, color: mine.c.color, ink: mine.c.ink, hex: mine.hex }] : []), [mine]);
  const mapVenues = useMemo(
    () => (results ?? []).map((r, i) => ({ venueId: r.venueId, rank: i + 1, name: venueName(r), location: r.location })),
    [results],
  );
  const select = useCallback((id: string) => setSelected(id), []);

  if (noKey) {
    return (
      <>
        <GroupHeader />
        <p className="error">This link is missing its key. Ask whoever shared it to send the whole link.</p>
      </>
    );
  }
  if (linkError)
    return (
      <>
        <GroupHeader />
        <p className="error" role="alert">{linkError}</p>
      </>
    );
  if (!status)
    return (
      <>
        <GroupHeader />
        <p className="hint">Opening the group…</p>
      </>
    );

  if (showResults && results) {
    return (
      <ResultsScreen
        title={status.members.filter((m) => m.ready).map((m) => m.alias).join(", ")}
        mode={mode}
        onEdit={() => setShowResults(false)}
        mapMembers={mapMembers}
        legend={mine ? [mine] : []}
        mapVenues={mapVenues}
        selected={selected}
        onSelect={select}
      >
        <ResultsList
          results={results}
          source={source}
          mode={mode}
          selected={selected}
          onSelect={select}
          venueName={venueName}
          memberOf={memberOf}
        />
      </ResultsScreen>
    );
  }

  return (
    <div className="planner">
      <GroupHeader />

      {showForm ? (
        <section aria-labelledby="you" className="join">
          <h2 id="you">{me ? "Change your landmark" : "Add yourself"}</h2>
          <label className="field">
            <span>Nickname</span>
            <input
              value={alias}
              maxLength={20}
              spellCheck={false}
              placeholder={me?.alias ?? "e.g. Bea"}
              onChange={(e) => setAlias(e.target.value)}
            />
          </label>
          <LandmarkPicker value={landmark} onChange={setLandmark} ariaLabel="your landmark" label="Landmark near where you'll start" />
          <p className="hint">
            Pick a public place, not your home. It's locked with a key that only exists in this link, nobody in the group
            can see it, and it's deleted after 48 hours.
          </p>
          <div className="join-actions">
            <button type="button" className="btn-accent" disabled={joining || !landmark || !(alias.trim() || me)} onClick={join}>
              {joining ? "Saving…" : me ? "Save" : "Join"}
            </button>
            {me && me.ready && (
              <button type="button" className="secondary" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          {joinError && <p className="error" role="alert">{joinError}</p>}
        </section>
      ) : (
        <div className="status-row" role="status">
          <MemberHex c={colorIndex(indexOf(me!.alias))} label={initialOf(me!.alias)} size="lg" />
          <p className="hint">
            You're in as <strong>{me!.alias}</strong>.
            <br />
            <small>Your landmark is hidden from the group.</small>
          </p>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Change landmark
          </button>
        </div>
      )}

      <section aria-labelledby="who">
        <h2 id="who">Who's in ({status.members.length}/10)</h2>
        <ul className="roster">
          {status.members.map((m, i) => (
            <li key={m.alias} className={m.you ? "me" : undefined}>
              <MemberHex c={colorIndex(i)} label={initialOf(m.alias)} size="md" />
              {m.alias}
              {m.you && <span className="tag you">you</span>}
              {!m.ready && <span className="tag muted">landmark expired</span>}
            </li>
          ))}
          {!me && <li className="empty">You?</li>}
        </ul>
        {!me && <p className="hint">You'll see nicknames and travel times, never anyone's landmark.</p>}
      </section>

      <SharePanel compact={!!me} />

      <ModePicker
        mode={mode}
        onChange={(m) => {
          setMode(m);
          setResults(null);
        }}
      />

      <button
        type="button"
        className="primary"
        aria-disabled={readyCount < 2 || loading}
        onClick={() => readyCount >= 2 && !loading && findSpots()}
      >
        {loading ? "Finding spots…" : "Find fair spots"}
      </button>
      <p className="hint plain">
        {readyCount < 2
          ? "Needs at least two people with landmarks. Anyone in the group can press this."
          : `${readyCount} people ready. Anyone in the group can press this.`}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** The link to send, with copy / share / QR. It contains the key, so it's shown only here. */
function SharePanel({ compact }: { compact: boolean }) {
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const u = window.location.href;
    setUrl(u);
    import("qrcode")
      .then((q) => q.toDataURL(u, { width: 220, margin: 1, errorCorrectionLevel: "M" }))
      .then(setQr)
      .catch(() => {});
  }, []);

  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  const share = () => navigator.share({ title: "Patas group", url }).catch(() => {});
  const qrImage = showQr && qr && <img className="qr-img" src={qr} width={220} height={220} alt="QR code of the group link" />;

  if (compact) {
    return (
      <>
        <section className="share compact" aria-label="Invite more people">
          <span>Invite more people</span>
          <button type="button" className="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
          {canShare && (
            <button type="button" className="secondary" onClick={share}>
              Share
            </button>
          )}
          {qr && (
            <button type="button" className="secondary" aria-label="Show QR code" aria-expanded={showQr} onClick={() => setShowQr((s) => !s)}>
              QR
            </button>
          )}
        </section>
        {qrImage}
      </>
    );
  }
  return (
    <section aria-labelledby="share" className="share">
      <h2 id="share">Invite the rest of your group</h2>
      <p className="hint">Anyone with the link can join, so share it only in your group chat.</p>
      <div className="share-row">
        <input readOnly value={url} aria-label="Group link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        {canShare && (
          <button type="button" className="btn-share" onClick={share}>
            Share
          </button>
        )}
      </div>
      {qr && (
        <button type="button" className="qr-toggle" aria-expanded={showQr} onClick={() => setShowQr((s) => !s)}>
          {showQr ? "Hide QR code ▾" : "Show QR code (same room) ▸"}
        </button>
      )}
      {qrImage}
    </section>
  );
}
