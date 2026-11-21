// Sali: установка как приложение. Сначала сеть (приложение часто обновляется), без сети — последняя сохранённая версия.
// Запросы к базе и чужим сайтам не трогаем.
const CACHE = 'sali-v3';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'manifest.webmanifest', 'pwa/icon-192.png', 'pwa/splash.jpg']).catch(() => {}))); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // страницу всегда сверяем с сервером (иначе браузер до 10 минут отдаёт старую версию); скрипты и так с ?v=
  e.respondWith(fetch(req, req.mode === 'navigate' ? { cache: 'no-cache' } : undefined).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});
