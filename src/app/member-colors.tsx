"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Member colours: 10 slots per theme from the design handover, each at least
 * 3:1 against the card surface. Slots 1-5 stay apart under protan, deutan and
 * tritan simulation; 6-10 can't all, so every swatch, hexagon and strip dot
 * also carries the member's initial (or row number). Colour is never the only cue.
 */
const PALETTE = {
  light: ["#174fb0", "#e07a1f", "#b0306f", "#1f9e91", "#7a5a00", "#7b5bd6", "#3d9be0", "#c43c2c", "#6f8a10", "#a07c08"],
  dark: ["#5a8ef0", "#f5a050", "#d9508f", "#46c9b9", "#a88520", "#b49af5", "#9ad8fa", "#ff8a73", "#86a82a", "#f5dc7a"],
};
/** Text colour inside each slot, picked for contrast. */
const INK = {
  light: ["#fff", "#141614", "#fff", "#141614", "#fff", "#fff", "#141614", "#fff", "#141614", "#141614"],
  dark: Array(10).fill("#141614") as string[],
};

export type MemberColor = { color: string; ink: string };

/** Colour for the i-th member (0-based), following the OS light/dark setting. */
export function useMemberColors(): (i: number) => MemberColor {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return useCallback(
    (i: number) => {
      const t = dark ? "dark" : "light";
      const slot = ((i % 10) + 10) % 10;
      return { color: PALETTE[t][slot], ink: INK[t][slot] };
    },
    [dark],
  );
}

/** First letter of a nickname, for hexagons and strip dots. */
export const initialOf = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?";

export function MemberHex({ c, label, size }: { c: MemberColor; label: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={size ? `hex ${size}` : "hex"} style={{ background: c.color, color: c.ink }} aria-hidden="true">
      {label}
    </span>
  );
}
