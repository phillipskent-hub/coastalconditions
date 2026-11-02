// Service worker: makes the app installable and usable offline.
//  - The page itself: network first, cached copy when offline.
//  - /api/*: network first; when offline, the last response for that exact URL, marked with an
//    X-Offline header so the page can say it's showing older data.
//  - Fonts and icons: cache first (they never change).
// Bump VERSION when this file's caching rules change; old caches are deleted on activate.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const STATIC = `static-${VERSION}`;
const MAX_DATA_ENTRIES = 30;

const SHELL_FILES = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon-32.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL, DATA, STATIC];
    for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    // Every link (?lat=...&station=...) is the same page, so keep one copy under '/'.
    event.respondWith(networkFirst(req, SHELL, '/', () => caches.match('/')));
  } else if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req, DATA, req, () => caches.match(req).then(markOffline), trimData));
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')
    || (url.origin === location.origin && url.pathname.startsWith('/icons/'))) {
    event.respondWith(cacheFirst(req, STATIC));
  }
});

async function networkFirst(req, cacheName, cacheKey, fallback, afterPut) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(cacheKey, res.clone());
      if (afterPut) afterPut(cache);
    }
    return res;
  } catch {
    return (await fallback()) || new Response(JSON.stringify({ error: 'You’re offline and this hasn’t been loaded before.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

function markOffline(res) {
  if (!res) return null;
  const headers = new Headers(res.headers);
  headers.set('X-Offline', '1');
  return new Response(res.body, { status: res.status, headers });
}

// Keep only the most recent API responses (cache keys are in insertion order).
async function trimData(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_DATA_ENTRIES))) await cache.delete(key);
}
