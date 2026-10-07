"use client";

import { useEffect } from "react";

/** Registers public/sw.js in production builds only, so dev never serves stale pages. */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installability still works without it; nothing to tell the user */
    });
  }, []);
  return null;
}
