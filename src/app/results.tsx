"use client";

import { useCallback, useEffect, useState } from "react";
import { rushHourRange, showsRushHour } from "@/lib/traffic";

/** Shared by the single-device planner and the group page. */

// No motorcycle: openrouteservice has no motorcycle profile, and showing car
// times under a "Motorcycle" label was wrong (motorcycles get through traffic).
export type Mode = "DRIVE" | "WALK";
export type Result = {
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
      text: "Times assume clear roads. © openrouteservice by HeiGIT | Data from OpenStreetMap",
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

/** Colour for the i-th member, following the OS light/dark setting. */
export function useMemberColors(): (i: number) => string {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return useCallback((i: number) => MEMBER_COLORS[dark ? "dark" : "light"][i] ?? OVERFLOW_COLOR, [dark]);
}

export function ModePicker({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <section aria-labelledby="how">
      <h2 id="how">How are you getting there?</h2>
      <div className="modes" role="radiogroup" aria-labelledby="how">
        {MODES.map((o) => (
          <label key={o.value} className={mode === o.value ? "mode on" : "mode"}>
            <input type="radio" name="mode" value={o.value} checked={mode === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      <p className="hint">Commute (jeepney, UV, train) times aren't supported yet.</p>
    </section>
  );
}

export function ResultsList({
  results,
  source,
  mode,
  selected,
  onSelect,
  venueName,
  nameOf,
  colorOf,
}: {
  results: Result[];
  source: string;
  /** The mode these results were computed for. */
  mode: Mode;
  selected: string | null;
  onSelect: (venueId: string) => void;
  venueName: (r: Result) => string;
  nameOf: (memberId: string) => string;
  colorOf: (memberId: string) => string;
}) {
  const maxMinutes = Math.max(1, ...results.flatMap((r) => r.perMember.map((p) => p.minutes)));
  const note = source ? sourceNote(source) : null;
  const rush = showsRushHour(source, mode);
  const range = (m: number) => rushHourRange(m).join("–");
  return (
    <section aria-labelledby="res" className="results">
      <h2 id="res">Fairest spots</h2>
      <p className="hint">Ranked so the longest trip is as short as possible, then by how even the trips are.</p>
      {note && <p className={note.warn ? "note warn" : "note"}>{note.text}</p>}
      {rush && (
        <p className="note rush">
          Rush hour: expect roughly 1.5 to 2 times these times. That's a Metro Manila-wide average from the TomTom
          Traffic Index, not live traffic, and it doesn't change the ranking.
        </p>
      )}
      {results.length === 0 && <p>No venue was reachable for everyone. Try a different travel mode.</p>}
      <ol className="venues">
        {results.map((r) => (
          <li key={r.venueId} className={r.venueId === selected ? "venue on" : "venue"} onClick={() => onSelect(r.venueId)}>
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
              <button type="button" className="link" onClick={() => onSelect(r.venueId)}>
                Show trips on map
              </button>
            )}
            <p className="stats">
              Longest trip <strong>{r.worst} min</strong>
              {rush && <> (about {range(r.worst)} min at rush hour)</>} · gap between longest and shortest {r.spread} min
            </p>
            <ul className={rush ? "bars rush" : "bars"}>
              {r.perMember.map((p) => (
                <li key={p.memberId}>
                  <span className="who">
                    <i className="swatch" style={{ background: colorOf(p.memberId) }} aria-hidden="true" />
                    {nameOf(p.memberId)}
                  </span>
                  <span className="bar" aria-hidden="true">
                    <span style={{ width: `${(p.minutes / maxMinutes) * 100}%` }} />
                  </span>
                  <span className="min">
                    {p.minutes} min
                    {rush && <small>{range(p.minutes)} rush</small>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
