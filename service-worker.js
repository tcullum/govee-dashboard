// service-worker.js — Clean version for Temp Spark v3 (Enhanced)

const CACHE_NAME = "temp-spark-v3.1"; // bump version when you update files
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.ico",
  "./favicon-16x16.png",
  "./favicon-32x32.png",
];

// INSTALL — cache static files only, activate immediately
self.addEventListener("install", event => {
  console.log("[SW] Installing...");

  // force this SW to take control immediately
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// ACTIVATE — clean up old caches, take control of clients immediately
self.addEventListener("activate", event => {
  console.log("[SW] Activating...");

  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );

      // take control of open pages right away
      await self.clients.claim();
      console.log("[SW] Ready and controlling clients.");
    })()
  );
});

// FETCH — network first for API, cache fallback for static assets
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // skip caching dynamic API calls
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      return (
        cached ||
        fetch(event.request).catch(() => caches.match("./index.html"))
      );
    })
  );
});
