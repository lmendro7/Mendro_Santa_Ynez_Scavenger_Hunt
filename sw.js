"use strict";

var CACHE = "mendro-shell-v3";
var IMG_CACHE = "mendro-refs-v1";
var IMG_MAX = 260;

var SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./data.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: "reload" }))["catch"](function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k !== IMG_CACHE) return caches["delete"](k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trim(c) {
  c.keys().then(function (keys) {
    var over = keys.length - IMG_MAX;
    for (var i = 0; i < over; i++) c["delete"](keys[i]);
  });
}

function cacheFirst(name, req, cap) {
  return caches.open(name).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) {
          c.put(req, res.clone())["catch"](function () {});
          if (cap) trim(c);
        }
        return res;
      })["catch"](function () {
        return Response.error();
      });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  if (url.hostname === "upload.wikimedia.org") {
    e.respondWith(cacheFirst(IMG_CACHE, req, true));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("./index.html").then(function (hit) {
        return hit || fetch(req)["catch"](function () { return caches.match("./"); });
      })
    );
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(CACHE, req, false));
  }
});
