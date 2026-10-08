"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { trackEvent } from "./analytics";
import type { Landmark } from "./landmark-picker";

const PinMap = dynamic(() => import("./pin-map"), { ssr: false, loading: () => <div className="map pin-map" /> });

type Nearby = Landmark & { metres?: number };

const away = (m?: number) =>
  m === undefined ? "" : m === 0 ? " · in this area" : m < 1000 ? ` · about ${Math.round(m / 100) * 100 || 100} m` : ` · ${(m / 1000).toFixed(1)} km`;

/**
 * "Can't find it? Look on the map": for places whose OSM spelling nobody
 * would guess. The pin only finds public landmarks near it, and the member
 * picks one of those; the pin itself is never used as a starting point, so
 * nobody can drop it on their house.
 */
export default function PinFinder({ onPick, onClose }: { onPick: (l: Landmark) => void; onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [cell, setCell] = useState<string | null>(null);
  const [results, setResults] = useState<Nearby[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    setFailed(false);
    if (!cell) return setResults(null);
    const ctl = new AbortController();
    fetch("/api/landmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cell }),
      signal: ctl.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        setResults(data.results ?? []);
        setFailed(false);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setFailed(true);
      });
    return () => ctl.abort();
  }, [cell]);

  const pick = ({ metres: _m, ...landmark }: Nearby) => {
    trackEvent("landmark-from-map", "Landmark picked from the map");
    onPick(landmark);
  };

  return (
    <dialog ref={dialog} className="pin-finder sheet" aria-labelledby={`${id}-title`} onClose={onClose}>
      <div className="sheet-head">
        <h2 id={`${id}-title`}>Find a landmark on the map</h2>
        <button type="button" className="close" aria-label="Close" onClick={() => dialog.current?.close()}>
          ×
        </button>
      </div>
      <div className="pin-warning" role="note">
        <strong>Don&apos;t put the circle on your home.</strong>
        <p>
          Patas never uses the spot you mark. It only lists public places near it, and even the place you pick is blurred to
          an area about 200 m across. That&apos;s on purpose, so nobody&apos;s home ends up in the app.
        </p>
      </div>
      <p className="hint">Move the map until the circle is near you, then pick a public place from the list.</p>
      <PinMap landmarks={results ?? []} onCell={setCell} onPick={pick} />
      <div aria-live="polite" className="nearby-count">
        {!cell && <p className="hint">Zoom in to see landmarks.</p>}
        {cell && !failed && results && results.length > 0 && (
          <p className="hint">
            {results.length === 1 ? "1 public place" : `${results.length} public places`} within about 1.5 km, nearest first
          </p>
        )}
        {cell && failed && <p className="hint">Couldn&apos;t look up landmarks. Check your connection.</p>}
        {cell && !failed && results?.length === 0 && <p className="hint">No landmarks within about 1.5 km. Try a busier spot nearby.</p>}
      </div>
      {cell && !failed && results && results.length > 0 && (
        <ol className="nearby">
          {results.map((l) => (
            <li key={`${l.name}-${l.cell}`}>
              <button type="button" onClick={() => pick(l)}>
                <span>
                  {l.name}
                  <small>
                    {l.kind.replace("_", " ")} · {l.area}
                    {away(l.metres)}
                  </small>
                </span>
                <span className="pick" aria-hidden="true">
                  Pick
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
        Cancel
      </button>
    </dialog>
  );
}
