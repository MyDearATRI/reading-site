/* Reading OS · Spotlight providers
   Four groups in the real Atlas Spotlight (A.spotlight.provide, rank 20, synchronous, at most 5 rows each):
   - Notes: the catalog's notes, matched on title, then topics, then field. A plan note says so in its subtitle.
   - Fields: the board's fields; Enter brings Shelf forward on that field.
   - Today: the line "today" or 今天 opens the Today window.
   - Daily reports: newest first.
   Rows carry a rank on Spotlight's own scale (score = rank × 10 + bias, bias 3 for providers), so a note whose
   title is typed in full is the Top hit ahead of a file stub or a window of the same name. No intent rows, no
   counts for due items (K1): a line that reads as prose only searches. */
(function (A) {
  "use strict";
  if (!A || !A.spotlight || !A.spotlight.provide) return;
  var K = A.K, FS = K && K.fs;
  var PLAN = "Plan · not yet learned";

  /* ---------- the catalog: A.reading.catalog (a value or a function), else the page's own JSON ---------- */
  var own = null;
  function catalog() {
    var R = A.reading, c = R && R.catalog;
    try { if (typeof c === "function") c = c(); } catch (e) { c = null; }
    if (c && c.notes) return c;
    if (own) return own;
    try { var s = document.getElementById("rdg-catalog"); own = s ? JSON.parse(s.textContent) : null; } catch (e) { own = null; }
    if (own && !own.notes) own = null;
    return own;
  }

  /* ---------- an index of lower-cased strings, built once per catalog ---------- */
  var idx = null, idxOf = null;
  function low(s) { return String(s == null ? "" : s).toLowerCase(); }
  function squeeze(s) { return s.replace(/\s+/g, ""); }
  function index() {
    var c = catalog();
    if (!c) return null;
    if (idx && idxOf === c) return idx;
    var ch = {}, daily = {}, notes = [], fields = [], dailies = [];
    (c.chapters || []).forEach(function (x) { ch[x.n] = x.title; });
    (c.dailies || []).forEach(function (d, i) { if (d && d.id) daily[d.id] = { date: String(d.date || ""), i: i }; });
    var byId = {};
    (c.notes || []).forEach(function (n) {
      if (!n || !n.id) return;
      byId[n.id] = n;
      if (daily[n.id]) return;   // daily reports are their own group
      notes.push({ n: n, t: low(n.title), ts: squeeze(low(n.title)), f: low(ch[n.ch] || ""), tp: (n.topics || []).map(low), field: ch[n.ch] || n.work || "" });
    });
    (c.chapters || []).forEach(function (x) {
      var core = (c.notes || []).filter(function (n) { return n.ch === x.n; });
      fields.push({ n: x.n, title: x.title, t: low(x.title), notes: core });
    });
    (c.dailies || []).forEach(function (d, i) {
      var n = byId[d.id]; if (!n) return;
      var stem = String(n.path || "").split("/").pop() || n.title || d.date;
      var label = stem.replace(/_/g, " ");
      dailies.push({ n: n, date: String(d.date || ""), i: i, label: label, t: low(label), nt: low(n.title) });
    });
    // newest first; reports of the same day keep the catalog's order
    dailies.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.i - b.i; });
    idxOf = c;
    return (idx = { c: c, notes: notes, fields: fields, dailies: dailies, latest: c.daily && c.daily.id });
  }

  /* ---------- Spotlight's matching: 0 exact, 1 prefix, 2 word start, 3 substring, -1 none ---------- */
  function rank(lower, q) {
    var i = lower.indexOf(q); if (i < 0) return -1;
    return lower === q ? 0 : i === 0 ? 1 : /[\s._\/\-·（(]/.test(lower[i - 1]) ? 2 : 3;
  }
  // on Spotlight's scale, a little ahead of a file, window or command that matches as well
  var TITLE_RANK = [-0.2, 0.5, 1.5, 2.5];

  /* ---------- actions ---------- */
  function stubPath(n) { return n && n.path ? "/Reading/" + n.path + ".note" : null; }
  function exists(p) { try { return !!(p && FS && FS.exists(p)); } catch (e) { return false; } }
  function openNote(n) {
    var R = A.reading;
    if (R && typeof R.openNote === "function") { R.openNote(n.id); return; }
    if (n.href) location.href = n.href;
  }
  function openToday() {
    var R = A.reading;
    if (R && typeof R.openToday === "function") { R.openToday(); return; }
    if (A.apps && A.apps.get("today")) A.apps.launch("today");
  }
  function shelfBoard() {
    var fr = document.getElementById("rdg-shelf");
    try { return fr && fr.contentWindow && fr.contentWindow.RDGBoard ? fr.contentWindow.RDGBoard : null; } catch (e) { return null; }
  }
  // Shelf focus on a field: whichever of these the Shelf side offers, in this order. Without any of them, Shelf
  // comes forward on the field's first core note, which the board opens and centres.
  function focusField(f) {
    var R = A.reading || {};
    if (typeof R.focusField === "function") { R.focusField(f.n); return; }
    if (typeof R.showField === "function") { R.showField(f.n); return; }
    var lead = f.notes.filter(function (n) { return n.tier === "core" && !n.plan; })[0] || f.notes.filter(function (n) { return n.tier === "core"; })[0] || f.notes[0];
    var B = shelfBoard();
    var viaBoard = function (B) {
      if (B && typeof B.focusField === "function") { B.focusField(f.n); return true; }
      if (B && typeof B.focusChapter === "function") { B.focusChapter(f.n); return true; }
      return false;
    };
    if (B && viaBoard(B)) { if (typeof R.showShelf === "function") R.showShelf(); return; }
    if (typeof R.showShelf === "function") R.showShelf(lead ? lead.id : undefined);
    else if (lead && lead.href) location.href = "shelf.html#n=" + encodeURIComponent(lead.id);
  }
  function icon(name, fallback) { return A.icons && A.icons[name] ? name : fallback; }

  /* ---------- Notes ---------- */
  A.spotlight.provide("Notes", function (line) {
    var q = low(line).trim(), qs = squeeze(q), ix = index();
    if (!q || !ix) return [];
    var hits = [];
    ix.notes.forEach(function (e) {
      var r = rank(e.t, q), score;
      if (r < 0 && qs !== q) r = rank(e.t, qs);
      if (r < 0 && qs) { r = rank(e.ts, qs); if (r >= 0 && r < 3 && e.ts !== qs) r = Math.max(r, 1); }   // "Transformer核心" finds "Transformer 核心（…）"
      if (r >= 0) score = TITLE_RANK[r];
      else {
        var best = -1;
        for (var k = 0; k < e.tp.length; k++) { var x = rank(e.tp[k], q); if (x >= 0 && (best < 0 || x < best)) best = x; }
        if (best >= 0) score = 3 + best * 0.1;
        else if (e.f && rank(e.f, q) >= 0) score = 3.6;
        else return;
      }
      hits.push({ e: e, s: score });
    });
    // better match first; then learned notes before plan notes, core before fill, shorter titles first
    hits.sort(function (a, b) {
      return a.s - b.s || (a.e.n.plan ? 1 : 0) - (b.e.n.plan ? 1 : 0) || (a.e.n.tier === "core" ? 0 : 1) - (b.e.n.tier === "core" ? 0 : 1) || a.e.t.length - b.e.t.length;
    });
    return hits.slice(0, 5).map(function (h) {
      var n = h.e.n, p = stubPath(n), has = exists(p);
      return { kind: "note", icon: "doc", title: n.title, subtitle: h.e.field + (n.plan ? " · " + PLAN : ""), rank: h.s,
        path: has ? p : undefined, cmd: has ? "open " + A.shPath(p) : "",
        run: function () { openNote(n); } };
    });
  }, 20);

  /* ---------- Fields ---------- */
  A.spotlight.provide("Fields", function (line) {
    var q = low(line).trim(), ix = index();
    if (!q || !ix) return [];
    var hits = [];
    ix.fields.forEach(function (f) { var r = rank(f.t, q); if (r >= 0) hits.push({ f: f, s: [0, 0.6, 1.6, 2.6][r] }); });
    hits.sort(function (a, b) { return a.s - b.s || a.f.n - b.f.n; });
    return hits.slice(0, 5).map(function (h) {
      return { kind: "field", icon: icon("shelf", "grid"), title: h.f.title, subtitle: "Show this field on Shelf", rank: h.s,
        cmd: A.reading && typeof A.reading.showField === "function" && K.bin && K.bin.shelf ? "shelf field " + h.f.n : "",
        run: function () { focusField(h.f); } };
    });
  }, 20);

  /* ---------- Today ---------- */
  var TODAY = ["today", "今天", "今日"];
  A.spotlight.provide("Today", function (line) {
    var q = low(line).trim();
    if (!q) return [];
    var r = -1;
    TODAY.forEach(function (w) { var x = q === w ? 0 : (q.length >= 3 && w.indexOf(q) === 0 ? 1 : -1); if (x >= 0 && (r < 0 || x < r)) r = x; });
    if (r < 0) return [];
    var app = A.apps && A.apps.get("today");
    return [{ kind: "today", icon: icon("calendar", "doc"), title: "Today", subtitle: "The latest daily report, rereads and notes you are reading",
      rank: r === 0 ? -0.5 : 1, cmd: app ? "open -a " + A.shQuote(app.name) : "", run: openToday }];
  }, 20);

  /* ---------- Daily reports ---------- */
  var DAILY_WORDS = ["daily", "daily report", "report", "日報", "每日", "精讀", "每日精讀"];
  A.spotlight.provide("Daily reports", function (line) {
    var q = low(line).trim(), ix = index();
    if (!q || !ix || !ix.dailies.length) return [];
    var word = DAILY_WORDS.some(function (w) { return w.indexOf(q) === 0 && q.length >= 2; });
    var out = [];
    ix.dailies.forEach(function (d) {
      var r = rank(d.t, q), s;
      if (r >= 0) s = TITLE_RANK[r];
      else if (rank(d.nt, q) >= 0 || word) s = 3;
      else return;
      out.push({ d: d, s: s });
    });
    // newest first (the list is already in that order)
    return out.slice(0, 5).map(function (h) {
      var n = h.d.n, p = stubPath(n), has = exists(p);
      return { kind: "daily", icon: icon("notes", "doc"), title: h.d.label, subtitle: n.id === ix.latest ? "Latest daily report" : "Daily report", rank: h.s,
        path: has ? p : undefined, cmd: has ? "open " + A.shPath(p) : "",
        run: function () {
          openNote(n);
          // opening the latest report is what the board counts as seeing it
          try { if (n.id === ix.latest && window.RDG && typeof window.RDG.markDaily === "function") window.RDG.markDaily(n.id); } catch (e) {}
        } };
    });
  }, 20);

  // rebuilds the index (a test, or a catalog swapped in later)
  A.spotlight.readingIndex = function () { idx = null; return index(); };
})(window.ATLAS = window.ATLAS || {});
