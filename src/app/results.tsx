"use client";

import type { Leg } from "@/lib/rail";
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
export type Mode = "DRIVE" | "WALK" | "RAIL";
export type Result = {
  venueId: string;
  name: string;
  location: { lat: number; lng: number } | null;
  tags: string[];
  worst: number;
  spread: number;
  total: number;
  /** `trip`: Train mode on the single-phone planner only (see MeetOptions.itineraries). */
  perMember: { memberId: string; minutes: number; trip?: Leg[] }[];
};
/** "Our usual spot" as /api/meet returns it: its result and rank, or a note that someone can't reach it. */
export type UsualResult = (Result & { rank: number; of: number }) | { venueId: string; name: string; unreachable: true };

/** How a member is shown in results: name, colour and the label inside their hexagon. */
export type ResultMember = { name: string; c: MemberColor; initial: string };

export const MODES: { value: Mode; label: string }[] = [
  { value: "DRIVE", label: "Car or ride‑hail" },
  { value: "WALK", label: "Walking" },
  { value: "RAIL", label: "Train" },
];
export const modeLabel = (m: Mode) => MODES.find((o) => o.value === m)!.label;

export const CATEGORY: Record<string, string> = {
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

/** openrouteservice's walking profile wasn't answering, so routing.ts used its hiking profile. */
const hikingNote = (source: string) =>
  source.includes("walk:foot-hiking") && (
    <p>
      openrouteservice's walking service isn't answering right now, so walking times come from its hiking profile: the same
      5 km/h on the same footpaths.
    </p>
  );

/** "walk 6 min to Katipunan (LRT-2) · LRT-2 to Araneta Center-Cubao (LRT-2), 12 min · …". Train minutes include the wait. */
export function tripText(legs: Leg[]): string {
  if (legs.length === 1 && legs[0].kind === "walk" && !legs[0].to) return `walk all the way, ${legs[0].min} min`;
  return legs
    .map((l) => {
      switch (l.kind) {
        case "walk":
          // A landmark that is the station itself rounds to 0 min.
          if (l.to && l.min < 1) return `start at ${l.to}`;
          return l.to ? `walk ${l.min} min to ${l.to}` : `walk ${l.min} min`;
        case "ride":
          return `car, taxi or tricycle ${l.min} min to ${l.to}`;
        case "train":
          return `${l.line} to ${l.to.replace(` (${l.line})`, "")}, ${l.min} min with the wait`;
        case "transfer":
          return `walk ${l.min} min to ${l.to}`;
      }
    })
    .join(" · ");
}

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
  if (source.includes("rail+")) {
    // Walking legs come from the walking provider; the train part from data/rail.json.
    return (
      <div className="caveat">
        <p>
          <b>Train times use typical run times and waits, not live schedules.</b> LRT-2 trains come about every 13 minutes;
          LRT-1 and MRT-3 every 4. The last trains leave between about 9 and 11 pm. A ride to the station counts
          clear-road driving plus 5 minutes to get one, so at rush hour it takes longer.
        </p>
        {hikingNote(source)}
        {source.includes("rail:no-rides") && (
          <p>Driving times didn't come through, so these assume everyone walks to a station. Anyone far from a line may do better with a ride.</p>
        )}
        {source.includes("openrouteservice") && <p className="credit">Walking and driving: {ORS_CREDIT}</p>}
      </div>
    );
  }
  if (source.includes("openrouteservice") && !source.startsWith("precomputed")) {
    return (
      <div className="caveat">
        <p>
          <b>Times assume clear roads.</b>
          {rushLine}
        </p>
        {hikingNote(source)}
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
      <p className="hint">Train means LRT-1, LRT-2 and MRT-3. Members walk to a station, or take a car, taxi or tricycle there when that's faster. Jeepney, UV and bus times aren't supported yet.</p>
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
  usual,
}: {
  results: Result[];
  source: string;
  /** The mode these results were computed for. */
  mode: Mode;
  selected: string | null;
  onSelect: (venueId: string) => void;
  venueName: (r: Result) => string;
  memberOf: (memberId: string) => ResultMember;
  usual?: UsualResult | null;
}) {
  const [how, setHow] = useState(false);
  const rush = showsRushHour(source, mode);
  const range = (m: number) => rushHourRange(m).join("–");
  // One scale for every card, so a tighter strip means a fairer spot.
  const usualRanked = usual && !("unreachable" in usual) ? usual : null;
  const longest = Math.max(0, ...[...results, ...(usualRanked ? [usualRanked] : [])].flatMap((r) => r.perMember.map((p) => p.minutes)));
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
      {usual && results[0] && <UsualCompare usual={usual} best={results[0]} pct={pct} memberOf={memberOf} />}
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
                    {usualRanked?.venueId === r.venueId && <span className="tag you">Your usual spot</span>}
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
                  {r.perMember.some((p) => p.trip?.some((l) => l.kind === "train")) && (
                    <div className="routes">
                      <p className="routes-title">How each person gets there</p>
                      <ul>
                        {r.perMember.map((p) => {
                          const m = memberOf(p.memberId);
                          return (
                            p.trip && (
                              <li key={p.memberId}>
                                <MemberHex c={m.c} label={m.initial} size="sm" />
                                <span>{tripText(p.trip)}</span>
                              </li>
                            )
                          );
                        })}
                      </ul>
                    </div>
                  )}
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

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
};
const listNames = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * How the group's usual spot compares with Patas's top pick. The ranking is
 * untouched: the habit is measured against it, not folded into it.
 */
function UsualCompare({
  usual,
  best,
  pct,
  memberOf,
}: {
  usual: UsualResult;
  best: Result;
  pct: (m: number) => number;
  memberOf: (memberId: string) => ResultMember;
}) {
  if ("unreachable" in usual) {
    return (
      <div className="usual" role="note">
        <p>
          <b>Your usual spot, {usual.name},</b> can't be reached by everyone with this travel mode.
        </p>
      </div>
    );
  }
  const longestBy = listNames(usual.perMember.filter((p) => p.minutes === usual.worst).map((p) => memberOf(p.memberId).name));
  const diff = usual.worst - best.worst;
  const shortest = Math.min(...usual.perMember.map((p) => p.minutes));
  const uneven = `the trips are less even (gap ${usual.spread} min against ${best.spread})`;
  return (
    <div className="usual" role="note">
      {usual.rank === 1 ? (
        <p>
          <b>Your usual spot, {usual.name}, is already the fairest</b> of the {usual.of} places Patas checked.
        </p>
      ) : (
        <p>
          <b>
            Your usual spot, {usual.name}, ranks {ordinal(usual.rank)} of {usual.of}.
          </b>{" "}
          Its longest trip is {usual.worst} min ({longestBy}),{" "}
          {diff > 0
            ? `${diff} min more than the top pick.`
            : diff === 0
              ? `the same as the top pick, but ${uneven}.`
              : `${-diff} min less than the top pick, but ${uneven}.`}
          {usual.rank <= 5 && " It's in the list below."}
        </p>
      )}
      {usual.rank > 5 && (
        <div className="strip-row">
          <TripStrip r={usual} shortest={shortest} pct={pct} memberOf={memberOf} />
          <span className="gap">gap {usual.spread} min</span>
        </div>
      )}
    </div>
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
