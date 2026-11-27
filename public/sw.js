// Service worker: caches the app shell only. API responses (private data) are never cached.
const VERSION = 'pn-v3';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/core.js', '/js/labels.js',
  '/js/views/auth.js', '/js/views/home.js', '/js/views/properties.js', '/js/views/clients.js', '/js/views/capture.js',
  '/js/views/services.js', '/js/views/settings.js', '/js/views/admin.js', '/js/views/public.js',
  '/fonts/Vazirmatn.woff2', '/img/mark.png', '/img/wordmark.png', '/img/wordmark-light.png', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so updates land immediately; fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
