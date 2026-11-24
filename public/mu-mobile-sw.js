// Existing PWA registrations update from this URL.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('mu-mobile-offline-')).map(key => caches.delete(key)));
    await self.registration.unregister();
  })());
});
