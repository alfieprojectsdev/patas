"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CATEGORY } from "./results";

/** A public venue from /api/venues. Nothing about a member. */
export type UsualSpot = { venueId: string; name: string; category: string; near: string | null };

const describe = (v: UsualSpot) => [CATEGORY[v.category] ?? v.category, v.near && `near ${v.near}`].filter(Boolean).join(" · ");

/**
 * "Our usual spot": the place the group always goes to. Optional. Patas ranks
 * it alongside its own picks, so the group can see how fair the habit is.
 */
export default function UsualSpotPicker({ value, onChange }: { value: UsualSpot | null; onChange: (v: UsualSpot | null) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<UsualSpot[]>([]);
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
        const res = await fetch("/api/venues", {
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

  const pick = (v: UsualSpot) => {
    onChange(v);
    setQ("");
    setOptions([]);
    setOpen(false);
  };

  if (value) {
    return (
      <div className="chosen">
        <span>
          <b>{value.name}</b>
          <small>{describe(value)}</small>
        </span>
        <button
          type="button"
          className="link"
          aria-label={`Remove ${value.name} as your usual spot`}
          onClick={() => {
            onChange(null);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          Remove
        </button>
      </div>
    );
  }

  const showList = open && q.trim().length >= 2 && searched === q;
  const listId = `${id}-list`;
  return (
    <div className="picker">
      <div className="picker-box">
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Your usual spot"
          aria-expanded={showList && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Café, fast food, library, mall…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!showList || !options.length) return;
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
        {showList && options.length > 0 && (
          <ul id={listId} role="listbox" className="options">
            {options.map((o, i) => (
              <li
                key={o.venueId}
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
                <small>{describe(o)}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      {showList && options.length === 0 && (
        <p className="hint">No match. Try the place's name plus a nearby station or mall, like "jollibee cubao".</p>
      )}
    </div>
  );
}

/** The optional "usual spot" question, shared by the planner and the group page. */
export function UsualSpotSection({ value, onChange }: { value: UsualSpot | null; onChange: (v: UsualSpot | null) => void }) {
  return (
    <section aria-labelledby="usual-spot">
      <h2 id="usual-spot">
        Your usual spot <span className="optional">(optional)</span>
      </h2>
      <p className="hint">If your group always meets at the same place, add it. Patas will show how fair it is next to its own picks.</p>
      <UsualSpotPicker value={value} onChange={onChange} />
    </section>
  );
}
