"use client";

import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

/**
 * A value from the URL fragment, e.g. useHashParam("k") for /g/<id>#k=abc.
 * Fragments are never sent to the server, which is why group links carry
 * their key there. Returns null during server rendering and hydration, then
 * the real value. (From washboard's src/lib/use-hash-param.ts.)
 */
export function useHashParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.hash.slice(1)).get(name),
    () => null,
  );
}
