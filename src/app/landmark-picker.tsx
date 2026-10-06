"use client";

import { useEffect, useId, useRef, useState } from "react";

/** A public landmark from /api/landmarks: its H3 cell and that cell's outline, never a point. */
export type Landmark = { name: string; kind: string; area: string; cell: string; hex: [number, number][] };

export default function LandmarkPicker({ value, onChange }: { value: Landmark | null; onChange: (l: Landmark | null) => void }) {
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
