// Patas service worker: only an offline page for page loads.
// It never caches API calls, group pages, map tiles or results, so no group
// data or landmark ever sits in the device's cache. (A fetch request never
// includes the #key part of a group link either.)
const CACHE = "patas-offline-v1";
const OFFLINE = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // leave every non-page request alone
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
