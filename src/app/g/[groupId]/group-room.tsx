"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import LandmarkPicker, { type Landmark } from "../../landmark-picker";
import { ModePicker, ResultsList, useMemberColors, type Mode, type Result } from "../../results";
import { useHashParam } from "../../use-hash-param";

const MeetMap = dynamic(() => import("../../map"), { ssr: false, loading: () => <div className="map" /> });

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
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const colorIndex = useMemberColors();

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
  const colorOf = (a: string) => colorIndex(indexOf(a));

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
      setSelected(data.results[0]?.venueId ?? null);
      setSource(data.source);
    } catch {
      setError("Couldn't reach Patas. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const venueName = (r: Result) => (r.venueId.startsWith("member:") ? `Near ${r.venueId.slice(7)}'s landmark` : r.name);
  const mapMembers = useMemo(
    () => (me && landmark && !editing ? [{ alias: me.alias, color: colorIndex(indexOf(me.alias)), hex: landmark.hex }] : []),
    [me?.alias, landmark, editing, colorIndex, status],
  );
  const mapVenues = useMemo(
    () => (results ?? []).map((r, i) => ({ venueId: r.venueId, rank: i + 1, name: venueName(r), location: r.location })),
    [results],
  );
  const select = useCallback((id: string) => setSelected(id), []);

  if (k === null && typeof window !== "undefined" && !window.location.hash.includes("k=")) {
    return <p className="error">This link is missing its key. Ask whoever shared it to send the whole link.</p>;
  }
  if (linkError) return <p className="error" role="alert">{linkError}</p>;
  if (!status) return <p className="hint">Opening the group…</p>;

  return (
    <div className="planner">
      <SharePanel />

      <section aria-labelledby="who">
        <h2 id="who">Who's in ({status.members.length}/10)</h2>
        {status.members.length === 0 ? (
          <p className="hint">Nobody yet. Add yourself below, then send the link.</p>
        ) : (
          <ul className="roster">
            {status.members.map((m, i) => (
              <li key={m.alias}>
                <i className="swatch" style={{ background: colorIndex(i) }} aria-hidden="true" />
                {m.alias}
                {m.you && <span className="tag">you</span>}
                {!m.ready && <span className="tag muted">landmark expired</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {showForm ? (
        <section aria-labelledby="you" className="member join">
          <h2 id="you" className="full">{me ? "Change your landmark" : "Add yourself"}</h2>
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
          <LandmarkPicker value={landmark} onChange={setLandmark} />
          <p className="hint full">
            Pick a public place near where you'll start, not your home. It's stored locked with a key that only exists in
            this link, nobody in the group can see it, and it's deleted after 48 hours.
          </p>
          <div className="full">
            <button type="button" className="secondary" disabled={joining || !landmark || !(alias.trim() || me)} onClick={join}>
              {joining ? "Saving…" : me ? "Save" : "Join"}
            </button>
            {me && me.ready && (
              <button type="button" className="link cancel" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          {joinError && <p className="error full" role="alert">{joinError}</p>}
        </section>
      ) : (
        <p className="hint">
          You're in as <strong>{me!.alias}</strong>.{" "}
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Change your landmark
          </button>
        </p>
      )}

      <ModePicker
        mode={mode}
        onChange={(m) => {
          setMode(m);
          setResults(null);
        }}
      />

      <button type="button" className="primary" disabled={readyCount < 2 || loading} onClick={findSpots}>
        {loading ? "Finding spots…" : "Find fair spots"}
      </button>
      {readyCount < 2 && <p className="hint">Needs at least two people with landmarks. Anyone in the group can press this.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {results && <MeetMap members={mapMembers} venues={mapVenues} selected={selected} onSelect={select} />}

      {results && (
        <ResultsList
          results={results}
          source={source}
          selected={selected}
          onSelect={setSelected}
          venueName={venueName}
          nameOf={(a) => a}
          colorOf={colorOf}
        />
      )}
    </div>
  );
}

/** The link to send, with copy / share / QR. It contains the key, so it's shown only here. */
function SharePanel() {
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
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
  return (
    <section aria-labelledby="share" className="share">
      <h2 id="share">Send this link to your group</h2>
      <p className="hint">Anyone with the link can join, so share it only in your group chat.</p>
      <div className="share-row">
        <input readOnly value={url} aria-label="Group link" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {}
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {canShare && (
          <button type="button" className="secondary" onClick={() => navigator.share({ title: "Patas group", url }).catch(() => {})}>
            Share
          </button>
        )}
      </div>
      {qr && (
        <details className="qr">
          <summary>Show QR code (for people in the same room)</summary>
          <img src={qr} width={220} height={220} alt="QR code of the group link" />
        </details>
      )}
    </section>
  );
}
