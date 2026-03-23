const CACHE_NAME = 'vmt-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean up old caches when a new service worker activates
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Skip non-GET requests (POST, PUT, DELETE should never be cached)
  if (event.request.method !== 'GET') {
    return;
  }

  // Network-first strategy for API calls — let the browser handle them normally
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache successful responses with valid status
        if (response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => {
          // Return cached response if available, otherwise return a fallback
          // so the browser doesn't show a raw network error
          return cachedResponse || new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' },
          });
        })
      )
  );
});
