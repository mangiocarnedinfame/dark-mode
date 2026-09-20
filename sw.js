var CACHE="cyber-timer-v1";
self.addEventListener("install",function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(["./","./index.html","./manifest.json","./icon-180.png","./icon-512.png"]);}));
});
self.addEventListener("activate",function(e){
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch",function(e){
  e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request);}));
});
