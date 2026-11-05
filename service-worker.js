// service-worker.js — House Weather v4
// Network-first for everything so updates always land; cache is only an
// offline fallback for the static shell.

const CACHE_NAME = "house-weather-v6.37";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./style.css",
  "./assets/dashboard-tabs.css",
  "./assets/desktop-overview.css",
  "./assets/desktop-overview.js",
  "./assets/d3-array.min.js",
  "./assets/d3-geo.min.js",
  "./manifest.json",
  "./favicon.ico",
  "./favicon-16x16.png",
  "./favicon-32x32.png",
  "./assets/autumn-cabin.png",
  "./assets/sensor-living-room.svg",
  "./assets/sensor-office.svg",
  "./assets/sensor-backyard.svg",
];

const STATIC_PATHS = new Set(STATIC_ASSETS.map(path => new URL(path, self.location.href).pathname));

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k.startsWith("house-weather-") && k !== CACHE_NAME).map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Never cache API calls or cross-origin requests
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  if (!STATIC_PATHS.has(url.pathname)) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok && !response.redirected) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch (e) {
        const cached = await caches.match(url.pathname);
        if (cached) return cached;
        return event.request.mode === "navigate" ? caches.match("/index.html") : Response.error();
      }
    })()
  );
});
