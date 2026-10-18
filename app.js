"use strict";

var ICON = { P: "\uD83C\uDF3F", I: "\uD83E\uDD8B", M: "\uD83E\uDD8C", B: "\uD83D\uDC26", H: "\uD83E\uDD8E" };
var DB = "mendro-hunt";
var API = "https://en.wikipedia.org/w/api.php";

/* ---------- species rows: readable whether data.js used var, let or const ---------- */
var ROWS = (function () {
  var src = (typeof SPECIES !== "undefined" && Array.isArray(SPECIES)) ? SPECIES
          : (Array.isArray(window.SPECIES) ? window.SPECIES : []);
  var seen = Object.create(null), out = [], skip = 0;
  src.forEach(function (r) {
    if (!Array.isArray(r) || r.length < 6 || !r[0] || !r[1]) { skip++; return; }
    if (seen[r[1]]) { skip++; return; }
    seen[r[1]] = 1; out.push(r);
  });
  out.skip = skip;
  return out;
})();

var db = null, found = new Set(), filter = "all", query = "";
var pending = null, myURLs = new Map(), lbURL = null;
var mem = Object.create(null), tried = new Set();

function $(s) { return document.querySelector(s); }
var listEl = $("#list"), countsEl = $("#counts"), pctEl = $("#pct"), fillEl = $("#fill"),
    statusEl = $("#status"), fileEl = $("#file"), toastEl = $("#toast"), lb = $("#lb"),
    lbImg = $("#lbImg"), capEl = $("#cap"), stageEl = $("#stage");

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function keyOf(i) { return ROWS[i][1]; }

/* ---------- storage ---------- */
function openDB() {
  return new Promise(function (res, rej) {
    var r;
    try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = function () {
      var d = r.result;
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos");
      if (!d.objectStoreNames.contains("refs")) d.createObjectStore("refs");
    };
    r.onsuccess = function () {
      var d = r.result;
      d.onversionchange = function () { try { d.close(); } catch (e) {} };
      res(d);
    };
    r.onerror = function () { rej(r.error); };
    r.onblocked = function () { rej(new Error("blocked")); };
  });
}
function store(name, mode) {
  if (!db) throw new Error("no-db");
  return db.transaction(name, mode).objectStore(name);
}
function get(name, k) {
  return new Promise(function (res, rej) {
    try { var q = store(name).get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }
    catch (e) { rej(e); }
  });
}
function put(name, k, v) {
  return new Promise(function (res, rej) {
    try { var q = store(name, "readwrite").put(v, k); q.onsuccess = function () { res(); }; q.onerror = function () { rej(q.error); }; }
    catch (e) { rej(e); }
  });
}
function del(name, k) {
  return new Promise(function (res, rej) {
    try { var q = store(name, "readwrite")["delete"](k); q.onsuccess = function () { res(); }; q.onerror = function () { rej(q.error); }; }
    catch (e) { rej(e); }
  });
}
function keys(name) {
  return new Promise(function (res, rej) {
    try { var q = store(name).getAllKeys(); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }
    catch (e) { rej(e); }
  });
}
function dump(name) {
  return new Promise(function (res, rej) {
    try {
      var out = [], q = store(name).openCursor();
      q.onsuccess = function () { var c = q.result; if (!c) { res(out); return; } out.push([c.key, c.value]); c["continue"](); };
      q.onerror = function () { rej(q.error); };
    } catch (e) { rej(e); }
  });
}

/* ---------- reference photos ---------- */
function apiThumb(title, n) {
  n = n || 1;
  var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var t = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : null;
  var u = API + "?action=query&format=json&formatversion=2&origin=*&redirects=1" +
          "&prop=pageimages&piprop=thumbnail&pithumbsize=640&titles=" + encodeURIComponent(title);
  return fetch(u, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
    if (t) clearTimeout(t);
    if (!r.ok) throw new Error("api " + r.status);
    return r.json();
  }).then(function (j) {
    var p = j.query && j.query.pages && j.query.pages[0];
    return (p && p.thumbnail && p.thumbnail.source) || null;
  })["catch"](function (err) {
    if (t) clearTimeout(t);
    if (n < 2) return new Promise(function (res) { setTimeout(res, 600); }).then(function () { return apiThumb(title, n + 1); });
    throw err;
  });
}
function refUrl(sp) {
  var k = sp[3];
  if (k in mem) return Promise.resolve(mem[k] || null);
  return get("refs", k)["catch"](function () { return null; }).then(function (c) {
    if (typeof c === "string" && c) { mem[k] = c; return c; }
    return apiThumb(k).then(function (u) { return u || (sp[4] ? apiThumb(sp[4]) : null); })
      .then(function (u) {
        if (!u) { mem[k] = ""; return null; }
        mem[k] = u;
        return put("refs", k, u).then(function () { return u; }, function () { return u; });
      });
  });
}
var q = [], active = 0, MAX = 3;
function queueRef(i) { if (tried.has(i)) return; tried.add(i); q.push(i); pump(); }
function pump() {
  while (active < MAX && q.length) {
    active++;
    (function (i) {
      loadRef(i).then(function () { active--; setTimeout(pump, 80); },
                      function () { active--; setTimeout(pump, 120); });
    })(q.shift());
  }
}
function loadRef(i) {
  var img = listEl.querySelector('img.r[data-i="' + i + '"]');
  if (!img) return Promise.resolve();
  return refUrl(ROWS[i]).then(function (u) {
    if (!u) return;
    img.onload = function () { img.classList.add("on"); };
    img.onerror = function () { img.classList.remove("on"); };
    img.src = u;
  });
}
var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function (es) {
  es.forEach(function (e) {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    var i = +e.target.dataset.i;
    queueRef(i);
    setCardState(i);
  });
}, { rootMargin: "300px" }) : null;

window.addEventListener("online", function () {
  tried.clear();
  listEl.querySelectorAll("img.r").forEach(function (im) {
    if (!im.classList.contains("on")) queueRef(+im.dataset.i);
  });
  toast("Back online");
});

/* ---------- render ---------- */
function render() {
  var f = document.createDocumentFragment();
  ROWS.forEach(function (sp, i) {
    var isF = found.has(keyOf(i));
    var li = document.createElement("li");
    li.dataset.i = i;
    li.dataset.g = sp[2];
    li.dataset.found = isF ? "1" : "0";
    li.innerHTML =
      '<div class="thumb"><span class="ph">' + (ICON[sp[2]] || "?") + '</span>' +
      '<img class="r" data-i="' + i + '" alt="" loading="lazy">' +
      '<span class="mine" data-act="zoom" hidden><img alt=""></span></div>' +
      '<div class="b"><h3>' + esc(sp[0]) + '<span class="lat">' + esc(sp[1]) + '</span></h3>' +
      '<p>' + esc(sp[5]) + '</p><div class="row">' +
      '<button class="btn cam" data-act="cam" data-found="' + (isF ? "1" : "0") + '">' +
      (isF ? "\u2713 Retake" : "\uD83D\uDCF7 Photo") + '</button>' +
      '<button class="btn clr" data-act="clr"' + (isF ? "" : " hidden") + '>Clear</button>' +
      '</div></div>';
    f.appendChild(li);
    var im = li.querySelector("img.r");
    if (io) io.observe(im); else queueRef(i);
  });
  listEl.appendChild(f);
}
function showMine(i) {
  var li = listEl.querySelector('li[data-i="' + i + '"]');
  if (!li) return Promise.resolve();
  var box = li.querySelector(".mine"), im = box.querySelector("img");
  if (!found.has(keyOf(i))) { box.hidden = true; im.removeAttribute("src"); return Promise.resolve(); }
  return get("photos", keyOf(i)).then(function (b) {
    if (!b) { found["delete"](keyOf(i)); return; }
    if (myURLs.has(i)) URL.revokeObjectURL(myURLs.get(i));
    var u = URL.createObjectURL(b);
    myURLs.set(i, u);
    im.src = u;
    box.hidden = false;
  })["catch"](function () {});
}
function setCardState(i) {
  var li = listEl.querySelector('li[data-i="' + i + '"]');
  if (!li) return;
  var isF = found.has(keyOf(i));
  li.dataset.found = isF ? "1" : "0";
  var cam = li.querySelector(".cam");
  cam.dataset.found = isF ? "1" : "0";
  cam.textContent = isF ? "\u2713 Retake" : "\uD83D\uDCF7 Photo";
  li.querySelector(".clr").hidden = !isF;
  showMine(i);
}
function refreshAll() {
  listEl.querySelectorAll("li").forEach(function (li) { setCardState(+li.dataset.i); });
  updateStats();
  applyFilter();
}
function updateStats() {
  var total = ROWS.length, done = 0;
  for (var i = 0; i < total; i++) if (found.has(keyOf(i))) done++;
  countsEl.textContent = total + " species \u00B7 " + done + " found" +
    (ROWS.skip ? " \u00B7 " + ROWS.skip + " bad rows skipped" : "");
  var p = total ? Math.round((done / total) * 100) : 0;
  pctEl.textContent = p + "%";
  fillEl.style.width = p + "%";
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(function (e) {
      var mb = ((e && e.usage) || 0) / 1048576;
      statusEl.innerHTML = "<b>" + mb.toFixed(1) + " MB</b> stored on this device \u00B7 <b>" +
        done + "</b> of <b>" + total + "</b> photographed";
    })["catch"](function () {});
  }
}

/* ---------- capture ---------- */
function encode(bmp, max) {
  return new Promise(function (res, rej) {
    var r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    var w = Math.round(bmp.width * r), h = Math.round(bmp.height * r);
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    c.toBlob(function (b) { b ? res(b) : rej(new Error("encode")); }, "image/jpeg", 0.82);
  });
}
function viaImg(file, max) {
  return new Promise(function (res, rej) {
    var u = URL.createObjectURL(file), im = new Image();
    im.onload = function () { encode(im, max).then(res, rej); URL.revokeObjectURL(u); };
    im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("decode")); };
    im.src = u;
  });
}
function shrink(file, max) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: "from-image" })
      .then(function (b) { return encode(b, max); })
      ["catch"](function () { return viaImg(file, max); });
  }
  return viaImg(file, max);
}
fileEl.addEventListener("change", function () {
  var f = fileEl.files && fileEl.files[0];
  if (!f || pending === null) { pending = null; return; }
  var i = pending;
  pending = null;
  shrink(f, 640).then(function (b) { return put("photos", keyOf(i), b); })
    .then(function () { found.add(keyOf(i)); setCardState(i); updateStats(); applyFilter(); toast("Captured \u2713"); })
    ["catch"](function () { toast("Couldn't save that photo"); });
});

/* ---------- card clicks ---------- */
listEl.addEventListener("click", function (e) {
  var li = e.target.closest("li");
  if (!li || !li.dataset.i) return;
  var i = +li.dataset.i, btn = e.target.closest("[data-act]"), act = btn && btn.dataset.act;

  if (act === "cam") { pending = i; fileEl.value = ""; fileEl.click(); return; }
  if (act === "clr") {
    found["delete"](keyOf(i));
    del("photos", keyOf(i))["catch"](function () {})["catch"](function () {});
    setCardState(i); updateStats(); applyFilter(); toast("Cleared");
    return;
  }
  if (act === "zoom") {
    get("photos", keyOf(i)).then(function (b) {
      if (b) openLB(URL.createObjectURL(b), ROWS[i][0] + " \u00B7 your photo");
    });
    e.stopPropagation();
    return;
  }
  if (e.target.closest(".thumb")) {
    var sp = ROWS[i];
    tried["delete"](i);
    refUrl(sp).then(function (u) {
      if (!u) { toast("No reference photo found"); return; }
      openLB(u, sp[0] + " \u00B7 " + sp[1]);
    })["catch"](function () { toast("Couldn't reach Wikipedia"); });
  }
});

/* ---------- lightbox ---------- */
var pz = { s: 1, x: 0, y: 0 }, pts = new Map(), p0 = 0, ps = 1, drag = null, moved = false, tap = 0, tapPos = null;
function applyZoom(anim) {
  lbImg.classList.toggle("grab", !anim);
  lbImg.style.transform = "translate(" + pz.x + "px," + pz.y + "px) scale(" + pz.s + ")";
}
function openLB(u, cap) {
  if (!u) { toast("No image"); return; }
  if (lbURL && lbURL.indexOf("blob:") === 0) URL.revokeObjectURL(lbURL);
  lbURL = u;
  pz = { s: 1, x: 0, y: 0 };
  lbImg.src = u;
  capEl.textContent = cap || "";
  lb.hidden = false;
  document.body.classList.add("lb-open");
  applyZoom(false);
}
function closeLB() {
  lb.hidden = true;
  lbImg.removeAttribute("src");
  document.body.classList.remove("lb-open");
  if (lbURL && lbURL.indexOf("blob:") === 0) URL.revokeObjectURL(lbURL);
  lbURL = null;
}
function dist() {
  var a = Array.from(pts.values());
  return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
}
stageEl.addEventListener("pointerdown", function (e) {
  stageEl.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, tx: pz.x, ty: pz.y }; moved = false; }
  if (pts.size === 2) { p0 = dist(); ps = pz.s; }
});
stageEl.addEventListener("pointermove", function (e) {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1 && drag) {
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    if (pz.s > 1) { pz.x = drag.tx + dx; pz.y = drag.ty + dy; applyZoom(false); }
  } else if (pts.size === 2 && p0) {
    moved = true;
    pz.s = Math.min(6, Math.max(1, (ps * dist()) / p0));
    applyZoom(false);
  }
});
stageEl.addEventListener("pointerup", function (e) {
  pts["delete"](e.pointerId);
  if (pts.size < 2) p0 = 0;
  if (pts.size > 0) return;
  drag = null;
  if (pz.s <= 1.02) { pz = { s: 1, x: 0, y: 0 }; applyZoom(true); }
  if (moved) return;
  var now = Date.now();
  if (now - tap < 300 && tapPos && Math.hypot(e.clientX - tapPos.x, e.clientY - tapPos.y) < 30) {
    tap = 0;
    pz = pz.s > 1.05 ? { s: 1, x: 0, y: 0 } : { s: 2.6, x: 0, y: 0 };
    applyZoom(true);
  } else { tap = now; tapPos = { x: e.clientX, y: e.clientY }; }
});
stageEl.addEventListener("pointercancel", function (e) { pts["delete"](e.pointerId); p0 = 0; });
$("#lbx").addEventListener("click", closeLB);
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !lb.hidden) closeLB(); });

/* ---------- filters ---------- */
function applyFilter() {
  var s = query.trim().toLowerCase();
  listEl.querySelectorAll("li").forEach(function (li) {
    var sp = ROWS[+li.dataset.i], ok = true;
    if (filter === "found") ok = found.has(keyOf(+li.dataset.i));
    else if (filter !== "all") ok = sp[2] === filter;
    if (ok && s) ok = (sp[0] + " " + sp[1] + " " + sp[5]).toLowerCase().indexOf(s) !== -1;
    li.classList.toggle("hide", !ok);
  });
}
$("#chips").addEventListener("click", function (e) {
  var c = e.target.closest(".chip");
  if (!c) return;
  document.querySelectorAll(".chip").forEach(function (x) { x.classList.remove("on"); });
  c.classList.add("on");
  filter = c.dataset.f;
  applyFilter();
});
$("#q").addEventListener("input", function (e) { query = e.target.value; applyFilter(); });

/* ---------- backup / restore ---------- */
function exportAll() {
  dump("photos").then(function (pairs) {
    var out = { app: "mendro-hunt", v: 1, exported: new Date().toISOString(), photos: {} };
    var chain = Promise.resolve();
    pairs.forEach(function (p) {
      chain = chain.then(function () {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { out.photos[p[0]] = fr.result; res(); };
          fr.onerror = function () { res(); };
          fr.readAsDataURL(p[1]);
        });
      });
    });
    return chain.then(function () {
      var blob = new Blob([JSON.stringify(out)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "mendro-hunt-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      toast("Backup: " + pairs.length + " photos");
    });
  })["catch"](function () { toast("Backup failed"); });
}
function importFile(f) {
  var fr = new FileReader();
  fr.onload = function () {
    var j;
    try { j = JSON.parse(fr.result); } catch (e) { toast("Not a backup file"); return; }
    var ph = (j && j.photos) || {}, names = Object.keys(ph), ok = 0;
    var chain = Promise.resolve();
    names.forEach(function (n) {
      chain = chain.then(function () {
        var known = ROWS.some(function (r) { return r[1] === n; });
        if (!known) return;
        return fetch(ph[n]).then(function (r) { return r.blob(); })
          .then(function (b) { return put("photos", n, b); })
          .then(function () { found.add(n); ok++; });
      });
    });
    chain.then(function () { refreshAll(); toast("Restored " + ok + " photos"); })
      ["catch"](function () { toast("Restore stopped after " + ok); });
  };
  fr.readAsText(f);
}
$("#exp").addEventListener("click", exportAll);
$("#imp").addEventListener("click", function () { $("#impFile").click(); });
$("#impFile").addEventListener("change", function (e) {
  var f = e.target.files && e.target.files[0];
  if (f) importFile(f);
  e.target.value = "";
});

/* ---------- toast ---------- */
var tt = null;
function toast(m) {
  toastEl.textContent = m;
  toastEl.classList.add("on");
  clearTimeout(tt);
  tt = setTimeout(function () { toastEl.classList.remove("on"); }, 2200);
}

/* ---------- boot ---------- */
function boot() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist()["catch"](function () {});
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(new URL("sw.js", location.href).href)["catch"](function () {});
    });
  }
  openDB().then(function (d) { db = d; return keys("photos"); })
    .then(function (k) { found = new Set(k); })
    ["catch"](function () { toast("Storage unavailable \u2014 photos won't save"); })
    .then(function () {
      if (!ROWS.length) { countsEl.textContent = "No species data"; toast("data.js didn't load"); }
      render();
      updateStats();
    });
}
boot();
