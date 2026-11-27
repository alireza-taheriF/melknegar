// Service worker: caches the app shell only. API responses (private data) are never cached.
// Static files: served instantly from cache, refreshed in the background
// (stale-while-revalidate). Pages: network first with a short timeout.
const VERSION = 'pn-v6';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/theme.js', '/js/app.js', '/js/core.js', '/js/labels.js',
  '/js/views/auth.js', '/js/views/home.js', '/js/views/properties.js', '/js/views/clients.js', '/js/views/capture.js',
  '/js/views/services.js', '/js/views/settings.js', '/js/views/admin.js', '/js/views/public.js',
  '/fonts/Vazirmatn.woff2', '/img/mark.png', '/img/mark-light.png', '/img/wordmark.png', '/img/wordmark-light.png', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function refresh(req) {
  return fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // Fresh HTML when the network is quick; cached shell when it is slow or offline.
    e.respondWith(new Promise((resolve) => {
      let done = false;
      const fallback = () => caches.match('/index.html').then((r) => { if (!done && r) { done = true; resolve(r); } });
      const t = setTimeout(fallback, 2500);
      refresh(req).then((r) => { clearTimeout(t); if (!done) { done = true; resolve(r); } })
        .catch(() => { clearTimeout(t); caches.match('/index.html').then((r) => { if (!done) { done = true; resolve(r || Response.error()); } }); });
    }));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = refresh(req).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  }));
});
