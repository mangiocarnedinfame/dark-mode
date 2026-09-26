/* Cache offline: dopo il primo caricamento l'app funziona senza rete */
var CACHE="interval-v18";
var FILES=["./","index.html","manifest.json","icon-152.png","icon-167.png","icon-180.png","icon-192.png","icon-512.png",
  "daydream_3/Daydream%20DEMO.otf","04b_30/04B_30__.TTF"];
self.addEventListener("install",function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener("activate",function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){if(k!==CACHE)return caches.delete(k);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener("fetch",function(e){
  if(e.request.method!=="GET")return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(function(r){
    return r||fetch(e.request).then(function(res){
      var copy=res.clone();caches.open(CACHE).then(function(c){c.put(e.request,copy);});return res;
    }).catch(function(){return caches.match("index.html");});
  }));
});
