/*
 * The smallest service worker that earns its place: it makes a second visit paint
 * without a network round trip, and it makes the app installable so "add to home
 * screen" is a real button rather than a screenshot of one.
 *
 * Two rules, and no third:
 *   - /api/** is never touched. A cached balance handed to a guest standing at a till
 *     is the dispute this platform exists to avoid (CONVENTIONS.md, counter app: lookup
 *     requires a connection by design). Freshness of loyalty data is the app's job,
 *     via the API client, where it can be labelled.
 *   - Everything else is the app shell: try the network, fall back to the cache. That
 *     way a deploy is picked up on the first online load, and a tunnel with no signal
 *     still opens the card.
 *
 * ponytail: no precache manifest and no build-step integration. The cache fills as the
 * shell is used; bump CACHE to evict everything. Add workbox when there is a reason.
 */

const CACHE = 'guest-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit !== undefined) return hit;
        // A route the guest has never opened, offline: hand back the shell so the
        // client router can render its own offline state instead of the browser's.
        const shell = await caches.match('/');
        if (shell !== undefined) return shell;
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }),
  );
});
