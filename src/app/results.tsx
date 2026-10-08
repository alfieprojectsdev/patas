"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { rushHourRange, showsRushHour } from "@/lib/traffic";
import { MemberHex, type MemberColor } from "./member-colors";
import type { MapMember, MapVenue } from "./map";

/** Shared by the single-device planner and the group page. */

// Leaflet needs `window`, so the map only renders in the browser.
const MeetMap = dynamic(() => import("./map"), { ssr: false, loading: () => <div className="map" /> });
export { MeetMap };

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
/** How a member is shown in results: name, colour and the label inside their hexagon. */
export type ResultMember = { name: string; c: MemberColor; initial: string };

export const MODES: { value: Mode; label: string }[] = [
  { value: "DRIVE", label: "Car or ride-hail" },
  { value: "WALK", label: "Walking" },
];
export const modeLabel = (m: Mode) => MODES.find((o) => o.value === m)!.label;

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

// Exact attribution required by the HeiGIT terms (ORS_ATTRIBUTION in src/lib/routing.ts).
const ORS_CREDIT = "© openrouteservice by HeiGIT | Data from OpenStreetMap";

function Caveat({ source, rush }: { source: string; rush: boolean }) {
  if (source.includes("straight-line-estimate")) {
    return (
      <div className="caveat">
        <p className="warn">Dev mode: times are straight-line guesses, not real routes. Don't use these to decide.</p>
      </div>
    );
  }
  const rushLine = rush && (
    <>
      {" "}
      Rush hour is about 1.5–2× longer: a Metro Manila average, not live traffic.
    </>
  );
  if (source.includes("openrouteservice") && !source.startsWith("precomputed")) {
    return (
      <div className="caveat">
        <p>
          <b>Times assume clear roads.</b>
          {rushLine}
        </p>
        <p className="credit">{ORS_CREDIT}</p>
      </div>
    );
  }
  if (source.startsWith("precomputed")) {
    const [, provider, built] = source.split(":");
    return (
      <div className="caveat">
        <p>
          Times precomputed with {provider} on {built}.{rushLine}
        </p>
        {provider === "openrouteservice" && <p className="credit">{ORS_CREDIT}</p>}
      </div>
    );
  }
  return (
    <div className="caveat">
      <p>{source.includes("google") ? "Times from Google Routes." : source}</p>
    </div>
  );
}

export function ModePicker({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <section aria-labelledby="how">
      <h2 id="how">How are you getting there?</h2>
      <div className="segmented" role="radiogroup" aria-labelledby="how">
        {MODES.map((o) => (
          <label key={o.value} className={mode === o.value ? "on" : undefined}>
            <input type="radio" name="mode" value={o.value} checked={mode === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      <p className="hint">Commute (jeepney, UV, train) times aren't supported yet.</p>
    </section>
  );
}

/**
 * The results screen: a top bar to go back and edit, the map with a legend,
 * and the ranked list. On desktop the list sits left and the map sticks right.
 */
export function ResultsScreen({
  title,
  mode,
  onEdit,
  mapMembers,
  legend,
  mapVenues,
  children,
  selected,
  onSelect,
}: {
  title: string;
  mode: Mode;
  onEdit: () => void;
  mapMembers: MapMember[];
  legend: { name: string; c: MemberColor; initial: string }[];
  mapVenues: MapVenue[];
  children: ReactNode;
  selected: string | null;
  onSelect: (venueId: string) => void;
}) {
  return (
    <div className="results-page">
      <div className="results-bar">
        <a href="/" className="bar-brand brand" aria-label="Patas home">
          <img src="/icons/icon.svg" width={30} height={30} alt="" />
          <span className="wordmark">Patas</span>
        </a>
        <img className="icon-only" src="/icons/icon.svg" width={26} height={26} alt="" />
        <div className="who">
          <b>{title}</b>
          <small>{modeLabel(mode)}</small>
        </div>
        <button type="button" className="secondary" onClick={onEdit}>
          <span className="short">Edit</span>
          <span className="long">Edit people or mode</span>
        </button>
      </div>
      <div className="results-body">
        <div className="map-wrap">
          <MeetMap members={mapMembers} venues={mapVenues} selected={selected} onSelect={onSelect} />
          <ul className="legend" aria-label="Who's who on the map">
            {legend.map((m, i) => (
              <li key={i}>
                <MemberHex c={m.c} label={m.initial} size="sm" />
                {m.name}
              </li>
            ))}
            <li className="note-area">each a ~200 m area</li>
          </ul>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ResultsList({
  results,
  source,
  mode,
  selected,
  onSelect,
  venueName,
  memberOf,
}: {
  results: Result[];
  source: string;
  /** The mode these results were computed for. */
  mode: Mode;
  selected: string | null;
  onSelect: (venueId: string) => void;
  venueName: (r: Result) => string;
  memberOf: (memberId: string) => ResultMember;
}) {
  const [how, setHow] = useState(false);
  const rush = showsRushHour(source, mode);
  const range = (m: number) => rushHourRange(m).join("–");
  // One scale for every card, so a tighter strip means a fairer spot.
  const longest = Math.max(0, ...results.flatMap((r) => r.perMember.map((p) => p.minutes)));
  const scale = Math.max(20, Math.ceil(longest / 10) * 10);
  const pct = (m: number) => (m / scale) * 100;

  return (
    <section aria-labelledby="res" className="results">
      <div className="results-head">
        <h2 id="res">Fairest spots</h2>
        <button type="button" className="link" aria-expanded={how} aria-controls="ranked-how" onClick={() => setHow((h) => !h)}>
          How is this ranked?
        </button>
      </div>
      {how && (
        <p id="ranked-how" className="ranked-how">
          Ranked so the longest trip is as short as possible, then by how even the trips are.
          {rush && " The rush-hour range doesn't change the order."}
        </p>
      )}
      {source && <Caveat source={source} rush={rush} />}
      {results.length === 0 && <p>No venue was reachable for everyone. Try a different travel mode.</p>}
      <ol className="venues">
        {results.map((r, i) => {
          const on = r.venueId === selected;
          const shortest = Math.min(...r.perMember.map((p) => p.minutes));
          const wifi = r.tags.some((t) => t.startsWith("wifi:") && t !== "wifi:no");
          return (
            // The venue name is a real button stretched over the whole card, so the card
            // selects on a tap while its heading and the OpenStreetMap link stay
            // separate for screen readers (children of role="button" are flattened).
            <li key={r.venueId} className={on ? "venue on" : "venue"}>
              <div className="venue-top">
                <span className="rank">{i + 1}</span>
                <div className="venue-name">
                  <h3>
                    <button type="button" className="venue-btn" aria-pressed={on} onClick={() => onSelect(r.venueId)}>
                      {venueName(r)}
                    </button>
                  </h3>
                  <div className="tags">
                    <span className="tag">{CATEGORY[r.tags[0]] ?? r.tags[0]}</span>
                    {wifi && <span className="tag">Wi-Fi listed</span>}
                  </div>
                </div>
                <div className="worst">
                  <strong>{r.worst} min</strong>
                  <small>longest trip</small>
                  {rush && <small>{range(r.worst)} at rush hour</small>}
                </div>
              </div>
              {on ? (
                <>
                  <ul className="trips">
                    {r.perMember.map((p) => {
                      const m = memberOf(p.memberId);
                      return (
                        <li key={p.memberId}>
                          <MemberHex c={m.c} label={m.initial} size="sm" />
                          <span className="name">{m.name}</span>
                          <span className="track" aria-hidden="true">
                            <span style={{ width: `${pct(p.minutes)}%`, background: m.c.color }} />
                          </span>
                          <span className="min" style={{ fontWeight: p.minutes === r.worst ? 800 : 500 }}>
                            {p.minutes} min
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="card-foot">
                    <span>
                      Gap, longest to shortest: <b>{r.spread} min</b>
                    </span>
                    {r.location && (
                      <a
                        className="osm-link"
                        href={`https://www.openstreetmap.org/?mlat=${r.location.lat}&mlon=${r.location.lng}#map=18/${r.location.lat}/${r.location.lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="short">Open map ↗</span>
                        <span className="long">Open in OpenStreetMap ↗</span>
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <div className="strip-row">
                  <TripStrip r={r} shortest={shortest} pct={pct} memberOf={memberOf} />
                  <span className="gap">gap {r.spread} min</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Everyone's minutes as dots on one shared line, with a band from the shortest trip to the longest. */
function TripStrip({
  r,
  shortest,
  pct,
  memberOf,
}: {
  r: Result;
  shortest: number;
  pct: (m: number) => number;
  memberOf: (memberId: string) => ResultMember;
}) {
  // Dots that would sit on top of each other are nudged 16 px apart, away from
  // the nearer end of the strip, so none spills past its edge.
  const nudge = (list: typeof r.perMember, dir: 1 | -1) => {
    let prev = -999;
    let lvl = 0;
    return list.map((p) => {
      const at = pct(p.minutes);
      lvl = Math.abs(at - prev) < 6 ? lvl + 1 : 0;
      prev = at;
      return { p, at, shift: dir * lvl * 16, m: memberOf(p.memberId) };
    });
  };
  const sorted = [...r.perMember].sort((a, b) => a.minutes - b.minutes);
  const dots = [
    ...nudge(sorted.filter((p) => pct(p.minutes) <= 50), 1),
    ...nudge(sorted.filter((p) => pct(p.minutes) > 50).reverse(), -1),
  ];
  return (
    <div className="strip" role="img" aria-label={r.perMember.map((p) => `${memberOf(p.memberId).name} ${p.minutes} min`).join(", ")}>
      <span className="axis" />
      <span className="band" style={{ left: `${pct(shortest)}%`, width: `${pct(r.worst) - pct(shortest)}%` }} />
      {dots.map(({ p, at, shift, m }) => (
        <span key={p.memberId} className="dot" style={{ left: `calc(${at}% + ${shift}px)`, background: m.c.color, color: m.c.ink }}>
          {m.initial}
        </span>
      ))}
    </div>
  );
}
