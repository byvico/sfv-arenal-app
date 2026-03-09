/* ============================================================
   SERVICE WORKER — SFV Arenal App
   Cachea todos los assets para funcionamiento 100% offline
   ============================================================ */
const CACHE_NAME = 'sfv-arenal-v1';

// Assets a cachear en la instalación
const PRE_CACHE = [
  '/index.html',
  '/manifest.json',
  '/firebase-sync.js',
  // CDN libraries — se cachean en el primer uso
];

// CDN origins que debemos cachear dinámicamente
const CACHE_CDN = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
];

// ── Instalación ─────────────────────────────────────────────
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRE_CACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activación ──────────────────────────────────────────────
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network-first para app, Cache-first para CDNs ────
self.addEventListener('fetch', evt => {
  const url = new URL(evt.request.url);

  // Firebase y APIs externas: siempre red (nunca cachear)
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis.com/firestore') ||
      url.hostname.includes('firebaseio.com')) {
    return; // deja que el navegador lo maneje normalmente
  }

  // CDN de librerías: Cache-first (offline funciona)
  const isCDN = CACHE_CDN.some(h => url.hostname.includes(h));
  if (isCDN) {
    evt.respondWith(
      caches.match(evt.request).then(cached => {
        if (cached) return cached;
        return fetch(evt.request).then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(evt.request, clone));
          }
          return resp;
        }).catch(() => cached); // offline y no cacheado → silencio
      })
    );
    return;
  }

  // App local: Network-first con fallback a caché
  evt.respondWith(
    fetch(evt.request)
      .then(resp => {
        if (resp && resp.status === 200 && evt.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(evt.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(evt.request))
  );
});

// ── Background Sync (dispara cuando vuelve la conexión) ─────
self.addEventListener('sync', evt => {
  if (evt.tag === 'sfv-sync-queue') {
    evt.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client =>
          client.postMessage({ type: 'TRIGGER_SYNC' })
        );
      })
    );
  }
});

// ── Push desde la app principal ─────────────────────────────
self.addEventListener('message', evt => {
  if (evt.data && evt.data.type === 'SKIP_WAITING') self.skipWaiting();
});
