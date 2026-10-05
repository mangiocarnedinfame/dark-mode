/* Offline cache: after the first load the app works without a network */
var CACHE="interval-v33";
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
/* Only page navigations may fall back to index.html: a font or an icon
   must never receive an HTML page. */
function isPageRequest(req){
  if(req.mode==="navigate")return true;
  var accept=req.headers.get("accept")||"";
  return accept.indexOf("text/html")>=0;
}
self.addEventListener("fetch",function(e){
  if(e.request.method!=="GET")return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(function(r){
    return r||fetch(e.request).then(function(res){
      /* cache only successful responses: never store 404/500 error pages */
      if(res&&res.ok){
        var copy=res.clone();caches.open(CACHE).then(function(c){c.put(e.request,copy);});
      }
      return res;
    }).catch(function(){
      if(isPageRequest(e.request))return caches.match("index.html");
      return Response.error();
    });
  }));
});
