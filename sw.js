/* Service worker – cache offline.
   IMPORTANTE: ogni volta che modifichi index.html, styles.css o app.js,
   cambia il numero di versione qui sotto (v1 → v2 → v3...).
   Senza quello l'app continuerebbe a mostrare la copia vecchia. */
var VERSION = 'interval-timer-v1';

var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== VERSION) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (res) {
        // mette in cache anche le richieste nuove dello stesso sito
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(VERSION).then(function (cache) {
            cache.put(e.request, copy);
          });
        }
        return res;
      }).catch(function () {
        // offline e risorsa non in cache: ripiega sulla pagina principale
        return caches.match('./index.html');
      });
    })
  );
});
