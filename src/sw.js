const CACHE_NAME = 'el-pecado-v2';
const ASSETS = [
  '/',
  '/pecar',
  '/logo.jpg',
  '/manifest.json',
  '/api/poemas/all'
];

// Instalar el Service Worker y almacenar en caché los recursos básicos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Precachando recursos obligatorios...');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activar el Service Worker y limpiar cachés antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Interceptar peticiones para servir desde caché (con estrategia Stale-While-Revalidate)
self.addEventListener('fetch', (event) => {
  // Solo interceptar peticiones GET locales
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Devolver del caché e ir a buscar al servidor en background para actualizar (Stale-While-Revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => {/* Ignorar errores de red en segundo plano */});
        return cachedResponse;
      }

      // Si no está en caché, buscar en la red
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        
        // No almacenar en caché endpoints de ordenes, webhooks u otras llamadas dinámicas
        if (url.pathname.startsWith('/create-order') || url.pathname.startsWith('/test-print') || url.pathname.startsWith('/webhook')) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Fallback offline para navegación de página
        if (event.request.mode === 'navigate') {
          return caches.match('/pecar');
        }
      });
    })
  );
});
