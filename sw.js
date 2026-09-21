var CACHE = "cyber-timer-v2";
var ASSETS = ["./", "./index.html", "./manifest.json", "./icon-180.png", "./icon-512.png", "./README.txt"];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key !== CACHE) return caches.delete(key);
      }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function(event) {
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});
