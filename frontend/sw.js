/* StudyFlow — Service Worker
 * Handles: App Shell caching, offline fallback, push notifications
 */

const CACHE_NAME = 'studyflow-shell-v39';

const APP_SHELL = [
  '/css/styles.css?v=29',
  '/js/app.js?v=31',
  '/js/auth.js?v=31',
  '/js/brain.js?v=31',
  '/js/calendar.js?v=32',
  '/js/interactions.js?v=39',
  '/js/store.js?v=31',
  '/js/tasks.js?v=31',
  '/js/ui.js?v=31',
  '/manifest.json'
];

// ─── Install: cache the App Shell ────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing, caching App Shell...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL);
    }).then(() => {
      console.log('[SW] App Shell cached successfully');
      return self.skipWaiting();
    }).catch(err => {
      console.warn('[SW] App Shell caching failed (some files may be missing):', err);
      // Don't fail the install — app can still work partially offline
      return self.skipWaiting();
    })
  );
});

// ─── Activate: remove old caches, claim clients ──────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating, cleaning old caches...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW] Activated, claiming clients');
      return self.clients.claim();
    })
  );
});

// ─── Fetch: cache-first for shell, network-first for API ─────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigation (HTML): always network-first so users never get a stale app shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, clone));
        return response;
      }).catch(() =>
        caches.match('/').then(c => c || caches.match(request))
      )
    );
    return;
  }

  // API calls: network-first, cache fallback, then offline response
  if (
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/tasks') ||
    url.pathname.startsWith('/exams') ||
    url.pathname.startsWith('/users') ||
    url.pathname.startsWith('/brain') ||
    url.pathname.startsWith('/regenerate')
  ) {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(request).then(cached => {
          if (cached) return cached;
          return new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
    return;
  }

  // App Shell and static assets: cache-first strategy
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        return cached;
      }

      return fetch(request).then(response => {
        // Only cache successful responses
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Offline fallback for navigation requests: serve cached root
        if (request.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ─── Push: receive push payload and show notification ────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'StudyFlow';
  const options = {
    body: data.body || 'Time to study!',
    icon: '/static/icon-192.png',
    badge: '/static/icon-192.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification click: open or focus the app ───────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
