"use strict";

var SPECIES = window.SPECIES || [];
var GROUP_ICON = { P: "\uD83C\uDF3F", I: "\uD83E\uDD8B", M: "\uD83E\uDD8C", B: "\uD83D\uDC26", H: "\uD83E\uDD8E" };
var DB_NAME = "mendro-hunt";
var API = "https://en.wikipedia.org/w/api.php";

var db = null;
var found = new Set();
var filter = "all";
var query = "";
var pending = null;
var myURLs = new Map();
var lbURL = null;

var $ = function (s) { return document.querySelector(s); };
var listEl = $("#list");
var countsEl = $("#counts");
var pctEl = $("#pct");
var fillEl = $("#fill");
var statusEl = $("#status");
var fileEl = $("#file");
var toastEl = $("#toast");
var lb = $("#lb");
var lbImg = $("#lbImg");
var capEl = $("#cap");
var stageEl = $("#stage");

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function keyOf(i) { return SPECIES[i][1]; }

/* ---------- IndexedDB ---------- */

function openDB() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = function () {
      var d = r.result;
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos");
      if (!d.objectStoreNames.contains("refs")) d.createObjectStore("refs");
    };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}

function get(store, key) {
  return new Promise(function (res, rej) {
    var r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}

function put(store, key, val) {
  return new Promise(function (res, rej) {
    var r = db.transaction(store, "readwrite").objectStore(store).put(val, key);
    r.onsuccess = function () { res(); };
    r.onerror = function () { rej(r.error); };
  });
}

function del(store, key) {
  return new Promise(function (res, rej) {
    var r = db.transaction(store, "readwrite").objectStore(store)["delete"](key);
    r.onsuccess = function () { res(); };
    r.onerror = function () { rej(r.error); };
  });
}

function allKeys(store) {
  return new Promise(function (res, rej) {
    var r = db.transaction(store).objectStore(store).getAllKeys();
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}

/* ---------- reference photos via the MediaWiki action API ---------- */

function apiThumb(title) {
  var u = API + "?action=query&format=json&formatversion=2&origin=*&redirects=1" +
    "&prop=pageimages&piprop=thumbnail&pithumbsize=640&titles=" + encodeURIComponent(title);
  return fetch(u).then(function (r) {
    if (!r.ok) throw new Error("api " + r.status);
    return r.json();
  }).then(function (j) {
    var p = j.query && j.query.pages && j.query.pages[0];
    return (p && p.thumbnail && p.thumbnail.source) || null;
  });
}

function getRefUrl(sp) {
  return get("refs", sp[3]).then(function (cached) {
    if (typeof cached === "string" && cached) return cached;
    return apiThumb(sp[3]).then(function (u) {
      if (u) return u;
      return sp[4] ? apiThumb(sp[4]) : null;
    }).then(function (u) {
      if (!u) return null;
      return put("refs", sp[3], u).then(function () { return u; });
    });
  });
}

var refQueue = [];
var refActive = 0;
var REF_MAX = 4;

function queueRef(i) {
  if (refQueue.indexOf(i) === -1) refQueue.push(i);
  pumpRef();
}

function pumpRef() {
  while (refActive < REF_MAX && refQueue.length) {
    refActive++;
    var i = refQueue.shift();
    var done = function () {
      refActive--;
      setTimeout(pumpRef, 80);
    };
    loadRef(i).then(done, done);
  }
}

function loadRef(i) {
  var sp = SPECIES[i];
  var img = listEl.querySelector('img.r[data-i="' + i + '"]');
  if (!img) return Promise.resolve();
  return getRefUrl(sp).then(function (url) {
    if (!url) return;
    img.onload = function () { img.classList.add("on"); };
    img.onerror = function () { img.classList.remove("on"); };
    img.src = url;
  });
}

var io = new IntersectionObserver(function (entries) {
  entries.forEach(function (e) {
    if (e.isIntersecting) {
      io.unobserve(e.target);
      queueRef(+e.target.dataset.i);
    }
  });
}, { rootMargin: "300px" });

/* ---------- render ---------- */

function render() {
  var frag = document.createDocumentFragment();
  SPECIES.forEach(function (sp, i) {
    var li = document.createElement("li");
    li.dataset.i = i;
    li.dataset.g = sp[2];
    li.dataset.found = found.has(keyOf(i)) ? "1" : "0";
    li.innerHTML =
      '<div class="thumb"><span class="ph">' + (GROUP_ICON[sp[2]] || "?") + '</span>' +
      '<img class="r" data-i="' + i + '" alt="" loading="lazy">' +
      '<span class="mine" data-act="zoom" hidden><img alt=""></span></div>' +
      '<div class="b"><h3>' + esc(sp[0]) + '<span class="lat">' + esc(sp[1]) + '</span></h3>' +
      '<p>' + esc(sp[5]) + '</p>' +
      '<div class="row"><button class="btn cam" data-act="cam" data-found="0">\uD83D\uDCF7 Photo</button>' +
      '<button class="btn clr" data-act="clr" hidden>Clear</button></div></div>';
    frag.appendChild(li);
    io.observe(li.querySelector("img.r"));
  });
  listEl.appendChild(frag);
}

function paintCard(i) {
  var li = listEl.querySelector('li[data-i="' + i + '"]');
  if (!li) return;
  var isFound = found.has(keyOf(i));
  li.dataset.found = isFound ? "1" : "0";
  var cam = li.querySelector(".cam");
  cam.dataset.found = isFound ? "1" : "0";
  cam.textContent = isFound ? "\u2713 Retake" : "\uD83D\uDCF7 Photo";
  li.querySelector(".clr").hidden = !isFound;
  var box = li.querySelector(".mine");
  var im = box.querySelector("img");
  if (!isFound) {
    box.hidden = true;
    im.removeAttribute("src");
    return;
  }
  get("photos", keyOf(i)).then(function (blob) {
    if (!blob) return;
    if (myURLs.has(i)) URL.revokeObjectURL(myURLs.get(i));
    var url = URL.createObjectURL(blob);
    myURLs.set(i, url);
    im.src = url;
    box.hidden = false;
  });
}

function updateStats() {
  var total = SPECIES.length;
  var done = 0;
  for (var i = 0; i < total; i++) if (found.has(keyOf(i))) done++;
  countsEl.textContent = total + " species \u00B7 " + done + " found";
  var p = total ? Math.round((done / total) * 100) : 0;
  pctEl.textContent = p + "%";
  fillEl.style.width = p + "%";
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(function (e) {
      var mb = ((e && e.usage) || 0) / 1048576;
      statusEl.innerHTML = "<b>" + mb.toFixed(1) + " MB</b> of photos stored on this device \u00B7 <b>" +
        done + "</b> of <b>" + total + "</b> photographed";
    })["catch"](function () {});
  }
}

/* ---------- photo capture ---------- */

function shrink(file, max) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var r = Math.min(1, max / Math.max(img.width, img.height));
      var w = Math.round(img.width * r);
      var h = Math.round(img.height * r);
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) { b ? res(b) : rej(new Error("encode")); }, "image/jpeg", 0.82);
    };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("decode")); };
    img.src = url;
  });
}

fileEl.addEventListener("change", function () {
  var f = fileEl.files && fileEl.files[0];
  if (!f || pending === null) return;
  var i = pending;
  pending = null;
  shrink(f, 640).then(function (blob) {
    return put("photos", keyOf(i), blob);
  }).then(function () {
    found.add(keyOf(i));
    paintCard(i);
    updateStats();
    applyFilter();
    toast("Captured \u2713");
  })["catch"](function () {
    toast("Couldn't save that photo");
  });
});

/* ---------- card interactions ---------- */

listEl.addEventListener("click", function (e) {
  var li = e.target.closest("li");
  if (!li) return;
  var i = +li.dataset.i;
  var btn = e.target.closest("[data-act]");
  var act = btn && btn.dataset.act;

  if (act === "cam") {
    pending = i;
    fileEl.value = "";
    fileEl.click();
    return;
  }
  if (act === "clr") {
    found["delete"](keyOf(i));
    del("photos", keyOf(i)).then(function () {
      paintCard(i);
      updateStats();
      applyFilter();
      toast("Cleared");
    });
    return;
  }
  if (act === "zoom") {
    get("photos", keyOf(i)).then(function (b) {
      if (!b) return;
      openLB(URL.createObjectURL(b), SPECIES[i][0] + " \u00B7 your photo");
    });
    e.stopPropagation();
    return;
  }
  if (e.target.closest(".thumb")) {
    var sp = SPECIES[i];
    getRefUrl(sp).then(function (url) {
      if (!url) { toast("No reference photo found"); return; }
      openLB(url, sp[0] + " \u00B7 " + sp[1]);
    })["catch"](function () { toast("Couldn't reach Wikipedia"); });
  }
});

/* ---------- lightbox with pinch / double-tap zoom ---------- */

var pz = { s: 1, x: 0, y: 0 };
var pts = new Map();
var pinchStart = 0;
var pinchScale = 1;
var dragStart = null;
var moved = false;
var lastTap = 0;
var lastPos = null;

function applyZoom(animate) {
  lbImg.classList.toggle("grab", !animate);
  lbImg.style.transform = "translate(" + pz.x + "px," + pz.y + "px) scale(" + pz.s + ")";
}

function openLB(url, caption) {
  if (!url) { toast("No image"); return; }
  if (lbURL && lbURL.indexOf("blob:") === 0) URL.revokeObjectURL(lbURL);
  lbURL = url;
  pz = { s: 1, x: 0, y: 0 };
  lbImg.src = url;
  capEl.textContent = caption || "";
  lb.hidden = false;
  applyZoom(false);
}

function dist() {
  var a = Array.from(pts.values());
  if (a.length < 2) return 0;
  return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
}

stageEl.addEventListener("pointerdown", function (e) {
  stageEl.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1) {
    dragStart = { x: e.clientX, y: e.clientY, tx: pz.x, ty: pz.y };
    moved = false;
  }
  if (pts.size === 2) {
    pinchStart = dist();
    pinchScale = pz.s;
  }
});

stageEl.addEventListener("pointermove", function (e) {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1 && dragStart) {
    var dx = e.clientX - dragStart.x;
    var dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    if (pz.s > 1) {
      pz.x = dragStart.tx + dx;
      pz.y = dragStart.ty + dy;
      applyZoom(false);
    }
  } else if (pts.size === 2 && pinchStart) {
    moved = true;
    pz.s = Math.min(6, Math.max(1, (pinchScale * dist()) / pinchStart));
    applyZoom(false);
  }
});

stageEl.addEventListener("pointerup", function (e) {
  pts["delete"](e.pointerId);
  if (pts.size < 2) pinchStart = 0;
  if (pts.size === 0) {
    dragStart = null;
    if (pz.s <= 1.02) { pz = { s: 1, x: 0, y: 0 }; applyZoom(true); }
    if (!moved) {
      var now = Date.now();
      if (now - lastTap < 300 && lastPos && Math.hypot(e.clientX - lastPos.x, e.clientY - lastPos.y) < 30) {
        lastTap = 0;
        if (pz.s > 1.05) { pz = { s: 1, x: 0, y: 0 }; } else { pz = { s: 2.6, x: 0, y: 0 }; }
        applyZoom(true);
      } else {
        lastTap = now;
        lastPos = { x: e.clientX, y: e.clientY };
      }
    }
  }
});

stageEl.addEventListener("pointercancel", function (e) {
  pts["delete"](e.pointerId);
  pinchStart = 0;
});

function closeLB() {
  lb.hidden = true;
  lbImg.removeAttribute("src");
  if (lbURL && lbURL.indexOf("blob:") === 0) URL.revokeObjectURL(lbURL);
  lbURL = null;
}

$("#lbx").addEventListener("click", closeLB);
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !lb.hidden) closeLB();
});

/* ---------- filters and search ---------- */

function applyFilter() {
  var q = query.trim().toLowerCase();
  listEl.querySelectorAll("li").forEach(function (li) {
    var i = +li.dataset.i;
    var sp = SPECIES[i];
    var ok = true;
    if (filter === "found") ok = found.has(keyOf(i));
    else if (filter !== "all") ok = sp[2] === filter;
    if (ok && q) ok = (sp[0] + " " + sp[1] + " " + sp[5]).toLowerCase().indexOf(q) !== -1;
    li.classList.toggle("hide", !ok);
  });
}

$("#chips").addEventListener("click", function (e) {
  var chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("on"); });
  chip.classList.add("on");
  filter = chip.dataset.f;
  applyFilter();
});

$("#q").addEventListener("input", function (e) {
  query = e.target.value;
  applyFilter();
});

/* ---------- toast ---------- */

var toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, 2200);
}

/* ---------- boot ---------- */

openDB().then(function (d) {
  db = d;
  return allKeys("photos");
}).then(function (keys) {
  found = new Set(keys);
}).catch(function () {
  toast("Storage unavailable \u2014 photos won't save");
}).then(function () {
  render();
  for (var i = 0; i < SPECIES.length; i++) if (found.has(keyOf(i))) paintCard(i);
  updateStats();
});
