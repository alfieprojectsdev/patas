"use client";

import { useCallback, useMemo, useState } from "react";
import LandmarkPicker, { type Landmark } from "./landmark-picker";
import { trackEvent } from "./analytics";
import { initialOf, MemberHex, useMemberColors } from "./member-colors";
import { MeetMap, ModePicker, ResultsList, ResultsScreen, type Mode, type Result, type ResultMember } from "./results";

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
const landmarkInputId = (key: number) => `landmark-${key}`;

export function usePlanner() {
  const [members, setMembers] = useState<Member[]>([
    { key: 1, alias: "", landmark: null },
    { key: 2, alias: "", landmark: null },
  ]);
  const [mode, setMode] = useState<Mode>("DRIVE");
  const [results, setResults] = useState<Result[] | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const colorOf = useMemberColors();

  const update = (key: number, patch: Partial<Member>) => {
    setMembers((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    setResults(null);
  };
  const remove = (key: number) => {
    setMembers((ms) => ms.filter((x) => x.key !== key));
    setResults(null);
  };
  const add = () => setMembers((ms) => [...ms, { key: nextKey++, alias: "", landmark: null }]);
  const changeMode = (m: Mode) => {
    setMode(m);
    setResults(null);
  };
  const aliasOf = (i: number) => members[i]?.alias.trim() || `Member ${i + 1}`;
  const missing = members.filter((m) => !m.landmark);
  const ready = members.length >= 2 && missing.length === 0;

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
      setShowResults(true);
      window.scrollTo(0, 0);
    } catch {
      setError("Couldn't reach Patas. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const memberIndex = (memberId: string) => Number(memberId.slice(1)) - 1;
  const memberOf = (memberId: string): ResultMember => {
    const i = memberIndex(memberId);
    const alias = members[i]?.alias.trim();
    return { name: aliasOf(i), c: colorOf(i), initial: alias ? initialOf(alias) : String(i + 1) };
  };
  const venueName = (r: Result) =>
    r.venueId.startsWith("member:") ? `Near ${aliasOf(memberIndex(r.venueId.slice(7)))}'s landmark` : r.name;

  const mapMembers = useMemo(
    () =>
      members.flatMap((m, i) => {
        if (!m.landmark) return [];
        const c = colorOf(i);
        const alias = m.alias.trim();
        return [{ initial: alias ? initialOf(alias) : String(i + 1), color: c.color, ink: c.ink, hex: m.landmark.hex }];
      }),
    [members, colorOf],
  );
  const mapVenues = useMemo(
    () => (results ?? []).map((r, i) => ({ venueId: r.venueId, rank: i + 1, name: venueName(r), location: r.location })),
    [results, members],
  );
  const select = useCallback((id: string) => setSelected(id), []);

  return {
    members, mode, results, source, error, loading, selected, showResults, missing, ready,
    update, remove, add, changeMode, findSpots, aliasOf, colorOf, memberOf, venueName, mapMembers, mapVenues, select,
    edit: () => setShowResults(false),
  };
}
export type PlannerState = ReturnType<typeof usePlanner>;

export function PlannerForm({ p }: { p: PlannerState }) {
  const { members, colorOf, aliasOf } = p;
  return (
    <div className="planner">
      <section aria-labelledby="who">
        <h2 id="who">Who's meeting?</h2>
        <p className="hint">
          Pick a public landmark near where each person starts: a station, a mall, a campus or office, a barangay hall. Not
          a home address.
        </p>
        <ol className="members">
          {members.map((m, i) => (
            <li key={m.key} className={members.length > 2 ? "member" : "member solo"}>
              <MemberHex c={colorOf(i)} label={String(i + 1)} />
              <input
                className="nick"
                value={m.alias}
                maxLength={20}
                spellCheck={false}
                placeholder={`Member ${i + 1}`}
                aria-label={`Member ${i + 1} nickname`}
                onChange={(e) => p.update(m.key, { alias: e.target.value })}
              />
              {members.length > 2 && (
                <button type="button" className="icon-btn" aria-label={`Remove ${aliasOf(i)}`} onClick={() => p.remove(m.key)}>
                  ×
                </button>
              )}
              <LandmarkPicker
                value={m.landmark}
                onChange={(l) => p.update(m.key, { landmark: l })}
                ariaLabel={`${aliasOf(i)}'s landmark`}
                inputId={landmarkInputId(m.key)}
              />
            </li>
          ))}
        </ol>
        {members.length < 10 && (
          <button type="button" className="secondary add-member" onClick={p.add}>
            + Add member
          </button>
        )}
      </section>

      <ModePicker mode={p.mode} onChange={p.changeMode} />

      <button
        type="button"
        className="primary"
        aria-disabled={!p.ready || p.loading}
        onClick={() => {
          if (p.loading) return;
          if (!p.ready) {
            const first = p.missing[0];
            if (first) document.getElementById(landmarkInputId(first.key))?.focus();
            return;
          }
          p.findSpots();
        }}
      >
        {p.loading ? "Finding spots…" : "Find fair spots"}
      </button>
      {!p.ready && (
        <div className="hint" role="status">
          <span>Still needs a landmark:</span>
          {p.missing.map((m) => (
            <button
              key={m.key}
              type="button"
              className="chip"
              onClick={() => document.getElementById(landmarkInputId(m.key))?.focus()}
            >
              {aliasOf(members.indexOf(m))}
            </button>
          ))}
        </div>
      )}
      {p.error && <p className="error" role="alert">{p.error}</p>}
    </div>
  );
}

const NO_VENUES: never[] = []; // stable, so the preview map doesn't redraw on every render

/** Desktop only: the members' areas beside the form, from the first landmark. */
export function PlannerPreview({ p }: { p: PlannerState }) {
  if (p.mapMembers.length === 0) return null;
  return (
    <>
      <MeetMap members={p.mapMembers} venues={NO_VENUES} selected={null} onSelect={p.select} />
      <p className="hint">Each start is drawn as a ~200 m area, never an exact spot.</p>
    </>
  );
}

export function PlannerResults({ p }: { p: PlannerState }) {
  const legend = p.members.map((_, i) => p.memberOf(`m${i + 1}`));
  return (
    <ResultsScreen
      title={p.members.map((_, i) => p.aliasOf(i)).join(", ")}
      mode={p.mode}
      onEdit={p.edit}
      mapMembers={p.mapMembers}
      legend={legend}
      mapVenues={p.mapVenues}
      selected={p.selected}
      onSelect={p.select}
    >
      <ResultsList
        results={p.results ?? []}
        source={p.source}
        mode={p.mode}
        selected={p.selected}
        onSelect={p.select}
        venueName={p.venueName}
        memberOf={p.memberOf}
      />
    </ResultsScreen>
  );
}
