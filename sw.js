// ============================================================
//  Cotolengo Turni — Service Worker v2.0
//  Cache offline para o PWA — Auto-versionamento por timestamp
// ============================================================

const CACHE_VERSION = '2';
const CACHE_NAME = `cotolengo-turni-v${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network-first for API calls, stale-while-revalidate for assets
  if (e.request.url.includes('script.google.com')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  } else {
    // Stale-while-revalidate: serve cache immediately, update in background
    e.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request).then(response => {
            if (response && response.status === 200) {
              cache.put(e.request, response.clone());
            }
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        });
      })
    );
  }
});
