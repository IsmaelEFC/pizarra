const CACHE_NAME = 'rutas-app-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache.map(url => new Request(url, { cache: 'reload' })))
          .catch(err => {
            console.log('Error caching some resources:', err);
            return Promise.resolve();
          });
      })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // No cachear archivos JS locales - dejar que el servidor los sirva directamente
  if (url.pathname.endsWith('.js') && url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    event.respondWith(fetch(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request)
          .catch(() => {
            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
          });
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
