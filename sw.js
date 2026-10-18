"use strict";

var SHELL = "mendro-shell-v4";
var IMGS = "mendro-refs-v2";
var IMG_MAX = 150;
var ASSETS = ["./", "./index.html", "./app.css", "./app.js", "./data.js",
              "./manifest.webmanifest", "./icon.svg"];

function abs(p) { return new URL(p, self.location).href; }

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(ASSETS.map(function (p) {
      return c.add(new Request(abs(p), { cache: "reload" }))["catch"](function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) {
      if (k !== SHELL && k !== IMGS) return caches["delete"](k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

function trim(c) {
  c.keys().then(function (ks) {
    var over = ks.length - IMG_MAX;
    for (var i = 0; i < over; i++) c["delete"](ks[i]);
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  if (url.hostname === "upload.wikimedia.org") {
    e.respondWith(caches.open(IMGS).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) {
            c.put(req, res.clone())["catch"](function () {});
            trim(c);
          }
          return res;
        })["catch"](function () { return Response.error(); });
      });
    }));
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(caches.open(SHELL).then(function (c) {
      return fetch(req).then(function (res) {
        if (res && res.ok) c.put(abs("./index.html"), res.clone())["catch"](function () {});
        return res;
      })["catch"](function () {
        return c.match(abs("./index.html")).then(function (hit) {
          return hit || c.match(abs("./"));
        });
      });
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    var clean = new URL(url.href);
    clean.search = "";
    var r2 = new Request(clean.href);
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(r2).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) c.put(r2, res.clone())["catch"](function () {});
          return res;
        })["catch"](function () { return hit; });
        return hit || net;
      });
    }));
  }
});
