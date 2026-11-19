const offlineCache = 'mu-mobile-offline-v2';
const offlinePage = '/mobil/offline.html';
const appPaths = new Set(['/mobil', '/trace', '/admin', '/manager', '/staff', '/staff/scan']);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(offlineCache);
    await cache.add(offlinePage);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('mu-mobile-offline-') && key !== offlineCache).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin ||
    (!appPaths.has(url.pathname) && !(url.pathname === '/' && url.searchParams.get('mobil') === '1'))) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(offlinePage)) ?? Response.error()));
});
