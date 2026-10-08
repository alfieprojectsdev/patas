"use client";

import { useEffect, useId, useRef, useState } from "react";
import PinFinder from "./pin-finder";

/** A public landmark from /api/landmarks: its H3 cell and that cell's outline, never a point. */
export type Landmark = { name: string; kind: string; area: string; cell: string; hex: [number, number][] };

const kindLabel = (k: string) => k.replace("_", " ");
const MAP_LABEL = "Can't find it? Look on the map";

/**
 * Landmark search. `label` is shown above the field; without it the field is
 * labelled for screen readers only by `ariaLabel` (the member row already says
 * whose landmark it is). `inputId` lets the Find hint focus this field.
 */
export default function LandmarkPicker({
  value,
  onChange,
  ariaLabel,
  label,
  inputId,
}: {
  value: Landmark | null;
  onChange: (l: Landmark | null) => void;
  ariaLabel: string;
  label?: string;
  inputId?: string;
}) {
  const id = useId();
  const fieldId = inputId ?? `${id}-input`;
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Landmark[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
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
    setPinOpen(false);
    onChange(l);
    setQ("");
    setOptions([]);
    setOpen(false);
  };
  const openMap = () => {
    setOpen(false);
    setPinOpen(true);
  };

  if (value) {
    return (
      <div className="picker">
        {label && <span className="field">{label}</span>}
        <div className="chosen">
          <span>
            <b>{value.name}</b>
            <small>
              {kindLabel(value.kind)} · {value.area}
            </small>
          </span>
          <button
            type="button"
            className="link"
            aria-label={`Change ${ariaLabel}`}
            onClick={() => {
              onChange(null);
              setTimeout(() => document.getElementById(fieldId)?.focus(), 0);
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  // The last row of the list is an action, not a landmark: it opens the map finder.
  const showList = open && q.trim().length >= 2 && searched === q;
  const count = options.length + (showList ? 1 : 0);
  const listId = `${id}-list`;
  return (
    <div className="picker">
      {label && (
        <label className="field" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <div className="picker-box">
        <input
          id={fieldId}
          ref={inputRef}
          role="combobox"
          aria-label={label ? undefined : ariaLabel}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Station, mall, campus, office…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!showList || !count) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % count);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + count) % count);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (active < options.length) pick(options[active]);
              else openMap();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button type="button" className="map-btn" aria-label={MAP_LABEL} onClick={openMap}>
          Map
        </button>
        {showList && (
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
                  {kindLabel(o.kind)} · {o.area}
                </small>
              </li>
            ))}
            <li
              id={`${id}-opt-${options.length}`}
              role="option"
              aria-selected={active === options.length}
              className={active === options.length ? "to-map active" : "to-map"}
              onMouseDown={(e) => {
                e.preventDefault();
                openMap();
              }}
            >
              {options.length ? MAP_LABEL : `No match. ${MAP_LABEL}`}
            </li>
          </ul>
        )}
      </div>
      {pinOpen && <PinFinder onPick={pick} onClose={() => setPinOpen(false)} />}
    </div>
  );
}
