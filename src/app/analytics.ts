"use client";

/**
 * GoatCounter events, same pattern as windowcards' src/analytics.js:
 * ithinkandicode.goatcounter.com, events sent as /event/<name>.
 *
 * Event names and titles must never carry nicknames, landmarks, cells, group
 * ids, keys or results: only what kind of action happened. GoatCounter's
 * count.js skips localhost, so dev runs aren't counted.
 */
type GoatCounter = { count: (v: { path: string; title: string; event: boolean }) => void };

export function trackEvent(name: string, title: string = name) {
  const gc = (window as unknown as { goatcounter?: GoatCounter }).goatcounter;
  if (typeof gc?.count === "function") gc.count({ path: `/event/${name}`, title, event: true });
}
