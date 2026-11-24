self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data;
  try { data = event.data?.json(); } catch { return; }
  if (!data || typeof data.title !== 'string' || typeof data.body !== 'string') return;
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/muterminal-app-icon.png',
    tag: data.tag,
    data: { target: data.target },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const allowed = ['/mobil', '/admin', '/manager', '/staff', '/trace', '/trace?panel=depo'];
  const target = event.notification.data?.target;
  const url = new URL(allowed.includes(target) ? target : '/mobil', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const alreadyOpen = clients.find(client => client.url === url);
    if (alreadyOpen) await alreadyOpen.focus();
    else await self.clients.openWindow(url);
  })());
});
