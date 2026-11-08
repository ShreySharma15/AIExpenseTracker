const CACHE = "expense-tracker-offline-v1";
const SHELL = "/offline.html";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(SHELL, { cache: "reload" }))));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith("expense-tracker-offline-") && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || event.request.mode !== "navigate"
    || url.origin !== self.location.origin || !["/", "/login"].includes(url.pathname)) return;
  event.respondWith(fetch(event.request, { cache: "no-store" }).catch(async () =>
    (await caches.open(CACHE)).match(SHELL).then(shell => shell ?? Response.error())
  ));
});
