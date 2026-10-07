"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import LandmarkPicker, { type Landmark } from "./landmark-picker";
import { trackEvent } from "./analytics";
import { ModePicker, ResultsList, useMemberColors, type Mode, type Result } from "./results";

// Leaflet needs `window`, so the map only renders in the browser.
const MeetMap = dynamic(() => import("./map"), { ssr: false, loading: () => <div className="map" /> });

/**
 * Single-device planner: one person enters each member's nickname and a
 * public landmark near where they'll start, then gets the fairest venues.
 * For members on their own phones, see the group page (src/app/g/).
 *
 * Privacy: nicknames never leave the browser; the API sees m1..mN. Landmarks
 * are H3 cells from /api/landmarks, sent once to /api/meet and not stored.
 */

type Member = { key: number; alias: string; landmark: Landmark | null };

let nextKey = 3;

export default function Planner() {
  const [members, setMembers] = useState<Member[]>([
    { key: 1, alias: "", landmark: null },
    { key: 2, alias: "", landmark: null },
  ]);
  const [mode, setMode] = useState<Mode>("DRIVE");
  const [results, setResults] = useState<Result[] | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const colorOf = useMemberColors();

  const update = (key: number, patch: Partial<Member>) => {
    setMembers((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    setResults(null);
  };
  const aliasOf = (i: number) => members[i]?.alias.trim() || `Member ${i + 1}`;
  const ready = members.length >= 2 && members.every((m) => m.landmark);

  async function findSpots() {
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch("/api/meet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origins: members.map((m, i) => ({ memberId: `m${i + 1}`, cell: m.landmark!.cell })),
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(res.status === 502 ? "Couldn't get travel times right now. Try again in a minute." : data.error ?? "Something went wrong.");
        return;
      }
      setResults(data.results);
      trackEvent(`search-${mode.toLowerCase()}`, `Search, one phone (${mode})`);
      setSelected(data.results[0]?.venueId ?? null);
      setSource(data.source);
    } catch {
      setError("Couldn't reach Patas. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const memberIndex = (memberId: string) => Number(memberId.slice(1)) - 1;
  const venueName = (r: Result) =>
    r.venueId.startsWith("member:") ? `Near ${aliasOf(memberIndex(r.venueId.slice(7)))}'s landmark` : r.name;

  const mapMembers = useMemo(
    () => members.flatMap((m, i) => (m.landmark ? [{ alias: aliasOf(i), color: colorOf(i), hex: m.landmark.hex }] : [])),
    [members, colorOf],
  );
  const mapVenues = useMemo(
    () => (results ?? []).map((r, i) => ({ venueId: r.venueId, rank: i + 1, name: venueName(r), location: r.location })),
    [results, members],
  );
  const select = useCallback((id: string) => setSelected(id), []);

  return (
    <div className="planner">
      <section aria-labelledby="who">
        <h2 id="who">Who's meeting?</h2>
        <p className="hint">
          Pick a public landmark near where each person starts: their school, a station, a mall, their barangay hall.
          Not a home address.
        </p>
        <ol className="members">
          {members.map((m, i) => (
            <li key={m.key} className="member">
              <label className="field">
                <span>
                  <i className="swatch" style={{ background: colorOf(i) }} aria-hidden="true" />
                  Nickname
                </span>
                <input
                  value={m.alias}
                  maxLength={20}
                  spellCheck={false}
                  placeholder={`Member ${i + 1}`}
                  onChange={(e) => update(m.key, { alias: e.target.value })}
                />
              </label>
              <LandmarkPicker value={m.landmark} onChange={(l) => update(m.key, { landmark: l })} />
              {members.length > 2 && (
                <button
                  type="button"
                  className="link remove"
                  onClick={() => {
                    setMembers((ms) => ms.filter((x) => x.key !== m.key));
                    setResults(null);
                  }}
                  aria-label={`Remove ${aliasOf(i)}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
        {members.length < 10 && (
          <button
            type="button"
            className="secondary"
            onClick={() => setMembers((ms) => [...ms, { key: nextKey++, alias: "", landmark: null }])}
          >
            Add member
          </button>
        )}
      </section>

      <ModePicker
        mode={mode}
        onChange={(m) => {
          setMode(m);
          setResults(null);
        }}
      />

      <button type="button" className="primary" disabled={!ready || loading} onClick={findSpots}>
        {loading ? "Finding spots…" : "Find fair spots"}
      </button>
      {!ready && <p className="hint">Every member needs a landmark first.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {mapMembers.length > 0 && <MeetMap members={mapMembers} venues={mapVenues} selected={selected} onSelect={select} />}

      {results && (
        <ResultsList
          results={results}
          source={source}
          mode={mode}
          selected={selected}
          onSelect={setSelected}
          venueName={venueName}
          nameOf={(id) => aliasOf(memberIndex(id))}
          colorOf={(id) => colorOf(memberIndex(id))}
        />
      )}
    </div>
  );
}
