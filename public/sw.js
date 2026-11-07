// Finance Hub service worker. Caches the app shell only; never API responses or signed-in pages.
const VERSION = '0.7.0';
const CACHE = `finance-hub-v${VERSION}`;
const SHELL = ['/', '/offline.html', '/app.css', '/app.js', '/offers.js', '/planner.js', '/smith.js', '/tax.js', '/wealth.js', '/watch.js', '/receipts.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('finance-hub-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page asks for the swap, so an open form is never interrupted.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return; // always network, never cached
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  if (SHELL.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Finance Hub', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Finance Hub', { body: d.body || '', icon: '/icons/icon-192.png', data: { url: d.url || '/cards?tab=reminders' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => { const c = list.find((w) => 'focus' in w); return c ? (c.navigate(url), c.focus()) : self.clients.openWindow(url); }));
});
