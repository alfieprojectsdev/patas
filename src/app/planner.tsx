"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

// Leaflet needs `window`, so the map only renders in the browser.
const MeetMap = dynamic(() => import("./map"), { ssr: false, loading: () => <div className="map" /> });

/**
 * Single-device planner (MVP step 1): one person enters each member's
 * nickname and a public landmark near where they'll start, then gets the
 * fairest venues.
 *
 * Privacy: nicknames never leave the browser; the API sees m1..mN. Landmarks
 * are H3 cells from /api/landmarks, sent once to /api/meet and not stored.
 * TODO(claude-code): join-code flow so each member picks their own landmark
 * on their own phone (needs a decision on where cells wait until everyone
 * has joined; see CLAUDE.md privacy rules).
 */

type Landmark = { name: string; kind: string; area: string; cell: string; hex: [number, number][] };
type Member = { key: number; alias: string; landmark: Landmark | null };
type Mode = "DRIVE" | "TWO_WHEELER" | "WALK";
type Result = {
  venueId: string;
  name: string;
  location: { lat: number; lng: number } | null;
  tags: string[];
  worst: number;
  spread: number;
  total: number;
  perMember: { memberId: string; minutes: number }[];
};

const MODES: { value: Mode; label: string }[] = [
  { value: "DRIVE", label: "Car or ride-hail" },
  { value: "TWO_WHEELER", label: "Motorcycle" },
  { value: "WALK", label: "Walking" },
];

const CATEGORY: Record<string, string> = {
  library: "Library",
  community_centre: "Community centre",
  coworking: "Co-working space",
  "shop:mall": "Mall",
  cafe: "Café",
  fast_food: "Fast food",
  restaurant: "Restaurant",
  host: "Someone's area",
};

function sourceNote(source: string): { text: string; warn: boolean } {
  if (source.includes("straight-line-estimate")) {
    return { text: "Dev mode: times are straight-line guesses, not real routes. Don't use these to decide.", warn: true };
  }
  if (source.includes("openrouteservice")) {
    // Exact attribution required by the HeiGIT terms (ORS_ATTRIBUTION in src/lib/routing.ts).
    return {
      text: "Typical speeds with no live traffic, so rush hour will be slower. © openrouteservice by HeiGIT | Data from OpenStreetMap",
      warn: false,
    };
  }
  if (source.includes("google")) return { text: "Times from Google Routes.", warn: false };
  if (source.startsWith("precomputed")) {
    const [, provider, built] = source.split(":");
    const credit = provider === "openrouteservice" ? " © openrouteservice by HeiGIT | Data from OpenStreetMap" : "";
    return { text: `Times precomputed with ${provider} on ${built}.${credit}`, warn: false };
  }
  return { text: source, warn: false };
}

// Categorical slots in fixed order (dataviz reference palette, validated for
// both modes). Every member is also labelled by name on the map and in the
// bars, so colour is never the only cue. Members 9-10 get neutral grey.
const MEMBER_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const OVERFLOW_COLOR = "#8a8a84";

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

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
  const dark = useDarkMode();
  const colorOf = (i: number) => MEMBER_COLORS[dark ? "dark" : "light"][i] ?? OVERFLOW_COLOR;

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
      setSelected(data.results[0]?.venueId ?? null);
      setSource(data.source);
    } catch {
      setError("Couldn't reach Patas. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const maxMinutes = Math.max(1, ...(results ?? []).flatMap((r) => r.perMember.map((p) => p.minutes)));
  const memberIndex = (memberId: string) => Number(memberId.slice(1)) - 1;
  const venueName = (r: Result) =>
    r.venueId.startsWith("member:") ? `Near ${aliasOf(memberIndex(r.venueId.slice(7)))}'s landmark` : r.name;
  const note = source ? sourceNote(source) : null;

  const mapMembers = useMemo(
    () => members.flatMap((m, i) => (m.landmark ? [{ alias: aliasOf(i), color: colorOf(i), hex: m.landmark.hex }] : [])),
    [members, dark],
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

      <section aria-labelledby="how">
        <h2 id="how">How are you getting there?</h2>
        <div className="modes" role="radiogroup" aria-labelledby="how">
          {MODES.map((o) => (
            <label key={o.value} className={mode === o.value ? "mode on" : "mode"}>
              <input
                type="radio"
                name="mode"
                value={o.value}
                checked={mode === o.value}
                onChange={() => {
                  setMode(o.value);
                  setResults(null);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
        <p className="hint">Commute (jeepney, UV, train) times aren't supported yet.</p>
      </section>

      <button type="button" className="primary" disabled={!ready || loading} onClick={findSpots}>
        {loading ? "Finding spots…" : "Find fair spots"}
      </button>
      {!ready && <p className="hint">Every member needs a landmark first.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {mapMembers.length > 0 && (
        <MeetMap members={mapMembers} venues={mapVenues} selected={selected} onSelect={select} />
      )}

      {results && (
        <section aria-labelledby="res" className="results">
          <h2 id="res">Fairest spots</h2>
          <p className="hint">Ranked so the longest trip is as short as possible, then by how even the trips are.</p>
          {note && <p className={note.warn ? "note warn" : "note"}>{note.text}</p>}
          {results.length === 0 && <p>No venue was reachable for everyone. Try a different travel mode.</p>}
          <ol className="venues">
            {results.map((r) => (
              <li
                key={r.venueId}
                className={r.venueId === selected ? "venue on" : "venue"}
                onClick={() => setSelected(r.venueId)}
              >
                <div className="venue-head">
                  <h3>
                    {r.location ? (
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${r.location.lat}&mlon=${r.location.lng}#map=18/${r.location.lat}/${r.location.lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {venueName(r)}
                      </a>
                    ) : (
                      venueName(r)
                    )}
                  </h3>
                  <span className="tag">{CATEGORY[r.tags[0]] ?? r.tags[0]}</span>
                  {r.tags.some((t) => t.startsWith("wifi:") && t !== "wifi:no") && <span className="tag">Wi-Fi listed</span>}
                </div>
                {r.venueId !== selected && (
                  <button type="button" className="link" onClick={() => setSelected(r.venueId)}>
                    Show trips on map
                  </button>
                )}
                <p className="stats">
                  Longest trip <strong>{r.worst} min</strong> · gap between longest and shortest {r.spread} min
                </p>
                <ul className="bars">
                  {r.perMember.map((p) => (
                    <li key={p.memberId}>
                      <span className="who">
                        <i className="swatch" style={{ background: colorOf(memberIndex(p.memberId)) }} aria-hidden="true" />
                        {aliasOf(memberIndex(p.memberId))}
                      </span>
                      <span className="bar" aria-hidden="true">
                        <span style={{ width: `${(p.minutes / maxMinutes) * 100}%` }} />
                      </span>
                      <span className="min">{p.minutes} min</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function LandmarkPicker({ value, onChange }: { value: Landmark | null; onChange: (l: Landmark | null) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Landmark[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setOptions([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/landmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q }),
          signal: ctl.signal,
        });
        const data = await res.json();
        setOptions(data.results ?? []);
        setSearched(q);
        setActive(0);
        if (document.activeElement === inputRef.current) setOpen(true);
      } catch {
        /* aborted or offline: keep the old list */
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const pick = (l: Landmark) => {
    onChange(l);
    setQ("");
    setOptions([]);
    setOpen(false);
  };

  if (value) {
    return (
      <div className="field">
        <span>Landmark</span>
        <div className="chosen">
          <span>
            {value.name} <small>{value.area}</small>
          </span>
          <button
            type="button"
            className="link"
            onClick={() => {
              onChange(null);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const listId = `${id}-list`;
  return (
    <div className="field picker">
      <label htmlFor={`${id}-input`}>Landmark</label>
      <input
        id={`${id}-input`}
        ref={inputRef}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="e.g. SM North, Katipunan station, Miriam College"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!options.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + options.length) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="options">
          {options.map((o, i) => (
            <li
              key={`${o.name}-${o.cell}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o.name}
              <small>
                {o.kind.replace("_", " ")} · {o.area}
              </small>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim().length >= 2 && searched === q && options.length === 0 && <p className="hint">No match. Try a nearby school or station.</p>}
    </div>
  );
}
