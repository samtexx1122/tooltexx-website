/* =========================================================
   TOOLTEXX SERVICE WORKER
   App-shell caching only. No third-party ad-network loader.
   ========================================================= */

var CACHE_NAME = "tooltexx-cache-v10";

var APP_SHELL = [
  "/",
  "/index.html",
  "/about.html",
  "/contact.html",
  "/privacy.html",
  "/terms.html",
  "/manifest.json",
  "/assets/style.css",
  "/assets/app.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png"
];

/* Files that must always be served fresh from the network and should
   never be served from (or written to) the cache. */
var NEVER_CACHE = [
  "/ads.txt",
  "/sitemap.xml",
  "/robots.txt"
];

function isNeverCached(pathname) {
  return NEVER_CACHE.indexOf(pathname) !== -1;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key !== CACHE_NAME;
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (isNeverCached(url.pathname)) {
    event.respondWith(fetch(request));
    return;
  }

  var isHTML =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").indexOf("text/html") !== -1;

  if (isHTML) {
    /* Network-first for HTML so visitors never get stuck on a stale
       page version; fall back to cache only when offline. */
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response && response.status === 200) {
            var responseClone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || caches.match("/index.html");
          });
        })
    );
    return;
  }

  /* Cache-first (with background refresh) for static assets. */
  event.respondWith(
    caches.match(request).then(function (cached) {
      var networkFetch = fetch(request)
        .then(function (response) {
          if (response && response.status === 200) {
            var responseClone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(function () {
          return cached;
        });

      return cached || networkFetch;
    })
  );
});
