/* Reading OS · rdg-core.js
   window.RDG: the reading state that the Shelf (shelf.html, standalone or framed with ?os) and the OS apps share.
   Everything lives in this browser's localStorage under keys that start with "rdg-"; every read and write is
   wrapped in try/catch, so a private window or blocked site data only means nothing is kept.

   Moved from board.html (the Today block): the reread clock, the latest daily report, the Today list and the
   once-a-day boot check. No counts, no lateness, no badges (K1). Built once as assets/rdg-core.js and loaded by
   both shelf.html and the OS page before anything that uses it. */
(function (root) {
  "use strict";
  if (root.RDG && root.RDG.v) return;

  /* ---------- storage ---------- */
  var PREFIX = "rdg-";
  function store() { try { return root.localStorage || null; } catch (e) { return null; } }
  function emit(key) {
    try { root.dispatchEvent(new CustomEvent("rdg:change", { detail: { key: key } })); } catch (e) {}
  }
  var ls = {
    get: function (k, d) { try { var s = store(), v = s ? s.getItem(k) : null; return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) {
      try { var s = store(); if (!s) return false; if (v === undefined || v === null) s.removeItem(k); else s.setItem(k, JSON.stringify(v)); } catch (e) { return false; }
      emit(k); return true;
    },
    remove: function (k) { try { var s = store(); if (s) s.removeItem(k); } catch (e) { return false; } emit(k); return true; },
    raw: function (k) { try { var s = store(); return s ? s.getItem(k) : null; } catch (e) { return null; } },
    // every key of this site (rdg-…), sorted
    keys: function () {
      var out = [];
      try { var s = store(); if (s) for (var i = 0; i < s.length; i++) { var k = s.key(i); if (k && k.indexOf(PREFIX) === 0) out.push(k); } } catch (e) {}
      return out.sort();
    },
    // bytes the browser holds for one key, or for all rdg- keys: UTF-16, two bytes per code unit, key and value
    bytes: function (k) {
      var one = function (key) { var v = ls.raw(key); return v == null ? 0 : (key.length + v.length) * 2; };
      if (k) return one(k);
      return ls.keys().reduce(function (n, key) { return n + one(key); }, 0);
    }
  };

  /* ---------- dates: the local day ---------- */
  function pad2(x) { return (x < 10 ? "0" : "") + x; }
  function localDate(d) { d = d || new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  // local midnight, plus some days, as an ISO time
  function dayStart(plus) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + (plus || 0)); return d.toISOString(); }

  /* ---------- reading status (rdg-progress: {id: {s, at}}) ---------- */
  var STATES = { todo: 1, reading: 1, done: 1 };
  function progress() { var p = ls.get("rdg-progress", {}); return p && typeof p === "object" && !Array.isArray(p) ? p : {}; }
  function status(id, prog) { var p = (prog || progress())[id]; return p && STATES[p.s] ? p.s : ""; }

  /* ---------- the reread clock (PRD 7.3): Done starts it; 1, 3, 7, 14 and 30 days; then it ends ---------- */
  var RR_DAYS = [1, 3, 7, 14, 30];
  // rdg-reread: {id: {i, due}}; anything malformed is dropped on read
  function rereads() {
    var raw = ls.get("rdg-reread", {}), out = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) Object.keys(raw).forEach(function (id) { var e = raw[id]; if (e && typeof e === "object" && !isNaN(Date.parse(e.due))) out[id] = { i: Math.max(0, Math.min(RR_DAYS.length - 1, +e.i || 0)), due: String(e.due) }; });
    return out;
  }
  // read, change, write in one step: a board and a Today window in the same browser never overwrite each other
  function scheduleReread(id) {
    var rr = rereads(); if (rr[id]) return false;
    rr[id] = { i: 0, due: dayStart(RR_DAYS[0]) }; ls.set("rdg-reread", rr); return true;
  }
  // "Reread done": the next interval counts from today. Returns {complete, nextDays} or null when nothing is scheduled
  function rereadDone(id) {
    var rr = rereads(), e = rr[id]; if (!e) return null;
    var i = e.i + 1, res;
    if (i >= RR_DAYS.length) { delete rr[id]; res = { complete: true, nextDays: 0 }; }
    else { rr[id] = { i: i, due: dayStart(RR_DAYS[i]) }; res = { complete: false, nextDays: RR_DAYS[i] }; }
    ls.set("rdg-reread", rr);
    return res;
  }

  /* ---------- notes known to this page ---------- */
  // shelf.html passes its own nodes; the OS page has the catalog (<script id="rdg-catalog">, or A.reading.catalog)
  var catalogCache = null, indexCache = null;
  function catalog() {
    if (catalogCache) return catalogCache;
    try { var r = root.ATLAS && root.ATLAS.reading, c = r && (typeof r.catalog === "function" ? r.catalog() : r.catalog); if (c && Array.isArray(c.notes)) return (catalogCache = c); } catch (e) {}
    try { var el = root.document && root.document.getElementById("rdg-catalog"); if (el) { var j = JSON.parse(el.textContent); if (j && Array.isArray(j.notes)) catalogCache = j; } } catch (e) {}
    return catalogCache;
  }
  function notesIndex() {
    if (indexCache) return indexCache;
    var c = catalog(); if (!c) return {};
    var m = {}; c.notes.forEach(function (n) { if (n && n.id) m[n.id] = n; });
    return (indexCache = m);
  }
  function isPaper(n) { return !!n && n.kind === "paper"; }
  // a note's date prefix (2026-11-20_…): the board calls it author, the catalog prefix
  function datePrefix(n) { var s = String((n && (n.prefix || n.author)) || ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }

  /* ---------- the latest daily report (PRD 6.5) ---------- */
  // data: {daily: {id, date}, notes|books: […]}. The build picks the report; otherwise the newest dated note.
  // daily(data) remembers it for this page; daily() returns what was remembered (or the catalog's)
  var current;
  function daily(data, byId) {
    if (!data) { if (current === undefined) current = daily(catalog() || {}, null); return current; }
    var list = data.notes || data.books || [], idx = byId || null;
    if (!idx) { idx = {}; list.forEach(function (n) { if (n && n.id) idx[n.id] = n; }); }
    var out = null;
    if (data.daily && data.daily.id && idx[data.daily.id]) { var dn = idx[data.daily.id]; out = { id: data.daily.id, date: String(data.daily.date || dn.prefix || dn.author || "") }; }
    else {
      // in the page's own order, so of two reports on the same date the first one listed wins
      var best = null, seq = list.length ? list : Object.keys(idx).map(function (id) { return idx[id]; });
      seq.forEach(function (n) { var dp = datePrefix(n); if (n && n.id && !isPaper(n) && dp && (!best || dp > best.date)) best = { id: n.id, date: dp }; });
      out = best;
    }
    current = out;
    return out;
  }
  // keyed by the report's note id, so a second report on the same date is not marked as opened
  function dailySeen(id) { var d = id ? { id: id } : daily(); return !!d && ls.get("rdg-daily-seen", "") === d.id; }
  function markDaily(id) { var d = daily(); if (d && d.id === id && !dailySeen()) { ls.set("rdg-daily-seen", d.id); return true; } return false; }

  /* ---------- Today (PRD 5.2, 6.5, 7.3): one list. K1: no counts, no lateness ---------- */
  // items: {k: "daily"|"reread"|"cont", id, n, seen?}; the latest daily report, rereads that are due (oldest due
  // first, up to 5, only while the note is Done), notes marked Reading (most recently set first, up to 3)
  // opts: {progress} (the board's own copy, else rdg-progress), {ready: false} (progress not loaded yet), {daily}
  function todayItems(byId, opts) {
    byId = byId || notesIndex(); opts = opts || {};
    var prog = opts.progress || progress(), d = opts.daily !== undefined ? opts.daily : daily();
    var out = [], used = {}, now = Date.now();
    if (d && byId[d.id]) { out.push({ k: "daily", id: d.id, n: byId[d.id], seen: dailySeen(d.id) }); used[d.id] = 1; }
    if (opts.ready === false) return out;
    var rr = rereads();
    Object.keys(rr).filter(function (id) { var n = byId[id]; return n && !isPaper(n) && !used[id] && status(id, prog) === "done" && Date.parse(rr[id].due) <= now; })
      .sort(function (a, b) { return Date.parse(rr[a].due) - Date.parse(rr[b].due); }).slice(0, 5)
      .forEach(function (id) { out.push({ k: "reread", id: id, n: byId[id] }); used[id] = 1; });
    var at = function (id) { var t = Date.parse(prog[id] && prog[id].at); return isNaN(t) ? 0 : t; };
    // the board's own order of notes (nodes) when it gives one, so ties stay in the same place
    var ids = opts.order || Object.keys(byId);
    ids.filter(function (id) { var n = byId[id]; return n && !isPaper(n) && !used[id] && status(id, prog) === "reading"; })
      .sort(function (a, b) { return at(b) - at(a); }).slice(0, 3)
      .forEach(function (id) { out.push({ k: "cont", id: id, n: byId[id] }); });
    return out;
  }
  function hasDue(items) { return (items || []).some(function (x) { return x.k === "reread" || (x.k === "daily" && !x.seen); }); }

  /* ---------- boot: the first visit of each local day, and only when something is due ---------- */
  var booted = false;
  function bootToday(onDue, byId, opts) {
    if (booted) return false; booted = true;
    var day = localDate(), last = ls.get("rdg-boot-date", "");
    ls.set("rdg-boot-date", day);
    var due = last !== day && hasDue(todayItems(byId, opts));
    if (due && typeof onDue === "function") { try { onDue(); } catch (e) { if (root.console) console.error(e); } }
    return due;
  }

  /* ---------- changes: another page (storage) or this page (rdg:change) ---------- */
  function onChange(fn) {
    var st = function (ev) { if (ev.key === null || (ev.key && ev.key.indexOf(PREFIX) === 0)) fn(ev.key, "storage"); };
    var me = function (ev) { fn(ev.detail && ev.detail.key, "local"); };
    root.addEventListener("storage", st); root.addEventListener("rdg:change", me);
    return function () { root.removeEventListener("storage", st); root.removeEventListener("rdg:change", me); };
  }

  root.RDG = {
    v: 1,
    ls: ls,
    localDate: localDate, dayStart: dayStart,
    RR_DAYS: RR_DAYS,
    progress: progress, status: status,
    rereads: rereads, scheduleReread: scheduleReread, rereadDone: rereadDone,
    catalog: catalog, notesIndex: notesIndex,
    daily: daily, dailySeen: dailySeen, markDaily: markDaily,
    todayItems: todayItems, hasDue: hasDue, bootToday: bootToday,
    onChange: onChange
  };
})(window);
