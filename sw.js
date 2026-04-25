// ============================================================
//  Cottolengo Turni — Service Worker v3.0
//  Cache offline para o PWA — API calls bypass SW completely
// ============================================================

const CACHE_VERSION = '16';
const CACHE_NAME = `cottolengo-escala-${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
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
  const url = e.request.url;

  // ── CRITICAL: Never intercept API calls ──
  // Google Apps Script redirects to googleusercontent.com,
  // and intercepting either domain causes CORS/redirect failures.
  if (url.includes('script.google.com') || 
      url.includes('googleusercontent.com') ||
      url.includes('googleapis.com')) {
    return; // Let the browser handle it natively
  }

  // Stale-while-revalidate for static assets only
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
});
