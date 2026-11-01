// Service worker for the installable app (manifest.json). One job only:
// when a page can't load because there's no signal (common on the Halsema),
// show offline.html instead of the browser's error page.
//
// Nothing else is cached on purpose: every page and API call still goes to
// the network, so a deploy is never hidden behind an old cached copy (see
// hooks/useReloadOnNewVersion.js). Bump CACHE when offline.html changes.
const CACHE = "drs-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
