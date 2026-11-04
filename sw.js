
const CACHE_NAME = 'returns-exceptions-v2';

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // لا نخزن طلبات تسجيل الدخول أو بيانات النظام
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.includes('/api/')
  ) {
    return;
  }

  // تحديث ملفات الموقع من الشبكة مع الرجوع للكاش عند انقطاع الاتصال
  if (
    request.mode === 'navigate' ||
    /\.(html|css|js|json)$/.test(url.pathname)
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return Response.error();
        }))
    );
  }
});
