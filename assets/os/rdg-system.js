/* ==========================================================================
   Reading OS · system (A.reading)
   The reading site inside Atlas OS: the catalog, the read-only /Reading file
   system and /var/log/build.log, the boot log lines, deep links (#n= #k
   #today #r=), the first run, ⌘K for Spotlight, keys and clicks inside
   same-origin frames, About Reading OS, and the Control Center rows
   (Reading depth, Reading data).

   Loaded after atlas.js and rdg-core.js (window.RDG), before the apps and
   atlas-main.js. atlas-main.js calls mount() right after the root disk is
   mounted (P10), firstRun() when no session comes back (P9) and ready()
   just before the boot screen (P11).

   Methods other packages add to A.reading, called here only when present:
   openNote(id, {newWindow}) (rdg-reader.js), showShelf(id?) and
   filterTray(s) (rdg-shelf.js), openToday() (rdg-today.js).

   Storage: only localStorage keys that start with "rdg-", read and written
   inside try/catch. This file writes "rdg-depth" (Control Center) and removes
   reading keys only on the two-step Remove reading data. sessionStorage
   "rdg-os-boot" remembers that the boot screen played in this tab.
   ========================================================================== */
(function (A) {
  "use strict";
  var K = A.K, FS = K.fs, HOME = K.home;
  var R = A.reading = A.reading || {};
  var esc = A.esc || function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var own = function (o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); };
  // ⌘ on Apple keyboards, Ctrl elsewhere (the board's test, board.html)
  var IS_APPLE = (function () { try { var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || ""; return /mac|iphone|ipad|ipod/i.test(p); } catch (e) { return false; } })();
  var CMDK = IS_APPLE ? "⌘K" : "Ctrl-K";
  var OS_KEYS = { "rdg-fs": "Disk image", "rdg-os-session": "Open windows" };   // what Erase and restart removes (P4)
  var DEPTHS = ["G1", "G2", "G3", "G4", "All"];
  var DEPTH_TITLE = { G1: "G1: a 3-minute overview", G2: "G2: key concepts in 15 minutes", G3: "G3: open problems and transfer", G4: "G4: a reading list linked to Zotero", All: "Every level" };
  var PREF = "com.reading.os";
  var LOGFILE = HOME + "/Library/Logs/reading.log";

  /* ---------- storage (every access guarded: private windows and blocked site data) ---------- */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) {} }
  function lsKeys() { var out = []; try { for (var i = 0; i < window.localStorage.length; i++) { var k = window.localStorage.key(i); if (k && k.indexOf("rdg-") === 0) out.push(k); } } catch (e) {} return out.sort(); }
  // the size the browser counts against its quota (UTF-16), as the disk gauge counts it (P2)
  function lsBytes(k) { var v = lsGet(k); return v == null ? 0 : (k.length + v.length) * 2; }
  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { window.sessionStorage.removeItem(k); } catch (e) {} }
  // same-document listeners (RDG.onChange) hear what this page changed; other documents get the storage event
  function changed(key) { try { window.dispatchEvent(new CustomEvent("rdg:change", { detail: { key: key } })); } catch (e) {} }

  /* ==========================================================================
     The catalog: <script type="application/json" id="rdg-catalog">
     ========================================================================== */
  var CAT = (function () {
    var c = null;
    try { var el = document.getElementById("rdg-catalog"); if (el) c = JSON.parse(el.textContent); } catch (e) { c = null; }
    if (!c || typeof c !== "object") { c = { v: 1, broken: true }; }
    ["notes", "dirs", "chapters", "dailies"].forEach(function (k) { if (!Array.isArray(c[k])) c[k] = []; });
    if (!c.counts || typeof c.counts !== "object") c.counts = {};
    return c;
  })();
  var BY = Object.create(null), CH = Object.create(null), PATH_OF = Object.create(null), BY_PATH = Object.create(null);
  CAT.notes.forEach(function (n) { if (n && n.id) BY[n.id] = n; });
  CAT.chapters.forEach(function (c) { if (c && c.n != null) CH[c.n] = c.title; });
  R.catalog = CAT;
  R.notesById = BY;
  R.byId = function (id) { return (id != null && BY[id]) || null; };
  R.field = function (n) { n = typeof n === "string" ? BY[n] : n; return n ? (CH[n.ch] || n.work || "") : ""; };
  // where a note's stub lives in /Reading, and the note a stub (or a link to one, ~/Reading/…) stands for
  R.pathOf = function (id) { return PATH_OF[id] || null; };
  R.byPath = function (p) {
    if (!p) return null;
    var abs = String(p); try { abs = FS.realpath(FS.resolve(HOME, abs)); } catch (e) { abs = FS.norm(abs); }
    return BY_PATH[abs] || null;
  };

  var builtMs = (function () { var t = Date.parse(CAT.built || ""); return isNaN(t) ? Date.now() : t; })();
  // the build time as the catalog has it, in UTC ("2026-11-20T16:04Z" reads "2026-11-20 16:04 UTC"); an older catalog
  // with an offset is shown without one
  function builtText() { var s = String(CAT.built || ""), m = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)/.exec(s); return m ? m[1] + " " + m[2] + (/Z$/i.test(s) ? " UTC" : "") : ""; }
  function nNotes() { return +CAT.counts.notes || CAT.notes.length; }
  function nDirs() { return +CAT.counts.dirs || CAT.dirs.length; }
  function nFields() { return +CAT.counts.fields || CAT.chapters.length; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  // the leak gate ran at build: build_site.py writes 0 only after its scan found nothing, and publishes nothing else
  function leakState() { return typeof CAT.leaks === "number" ? (CAT.leaks === 0 ? "clean" : "found") : "unchecked"; }
  function daily() { var d = CAT.daily; return d && d.id ? { id: d.id, date: String(d.date || ""), note: BY[d.id] || null } : null; }

  /* ==========================================================================
     /Reading: one read-only folder per site folder, one <stem>.note stub per note
     ========================================================================== */
  function cleanPath(p) { return String(p || "").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/"); }
  function stub(n) {
    var href = String(n.href || ""), sum = String(n.summary || "").replace(/\s+/g, " ").trim();
    try { href = decodeURI(href); } catch (e) {}
    return "Reading note (link to the note page; the note text is not stored here)\n" +
      "Title: " + (n.title || "") + "\n" +
      "Field: " + R.field(n) + "\n" +
      (n.plan ? "Status: plan, not yet learned\n" : "") +
      (sum ? "Summary: " + sum + "\n" : "") +
      "Page: /" + href.replace(/^\/+/, "") + "\n";
  }
  function readingTree() {
    var dirs = Object.create(null);
    var dir = function (p) {
      if (dirs[p]) return dirs[p];
      var d = dirs[p] = { kids: Object.create(null), node: null };
      if (p) { var i = p.lastIndexOf("/"), up = i < 0 ? "" : p.slice(0, i), name = p.slice(i + 1); var pd = dir(up); if (!pd.kids[name]) pd.kids[name] = { dir: p }; }
      return d;
    };
    dir("");
    CAT.dirs.forEach(function (d) { var p = cleanPath(d && d.path); if (p) dir(p); });
    CAT.notes.forEach(function (n) {
      var p = cleanPath(n.path); if (!p || !n.id) return;
      var i = p.lastIndexOf("/"), up = i < 0 ? "" : p.slice(0, i), name = p.slice(i + 1) + ".note";
      dir(up).kids[name] = { note: n, node: null };
      PATH_OF[n.id] = "/Reading/" + p + ".note"; BY_PATH[PATH_OF[n.id]] = n;
    });
    var dnode = function (p) {
      var d = dirs[p]; if (d.node) return d.node;
      return (d.node = K.mknode("d", { virt: true, ro: "reading", mode: 365, mtime: builtMs, ctime: builtMs,
        list: function () { return Object.keys(d.kids); },
        get: function (name) {
          if (!own(d.kids, name)) return null;
          var k = d.kids[name];
          if (k.dir != null) return dnode(k.dir);
          return k.node || (k.node = K.mknode("f", { read: function () { return stub(k.note); }, ro: "reading", mode: 292, mtime: builtMs, ctime: builtMs }));
        } }));
    };
    return dnode("");
  }
  // /var/log/build.log: what the build wrote into the catalog, and nothing else
  function buildLog() {
    var at = CAT.built ? String(CAT.built) + " " : "", d = daily(), out = [];
    if (CAT.broken) return "The catalog of this page could not be read.\n";
    out.push(at + "INFO build: Reading site built from source " + (CAT.source || "unknown"));
    out.push(at + "INFO build: " + plural(nNotes(), "note", "notes") + " in " + plural(nDirs(), "folder", "folders") + ", " + plural(nFields(), "field", "fields"));
    if (d) out.push(at + "INFO build: latest daily report " + d.date + (d.note ? " (" + d.note.title + ")" : ""));
    var ls = leakState();
    if (ls === "clean") out.push(at + "INFO privacy: leak check 0 (a build that finds any leak is not published)");
    else if (ls === "found") out.push(at + "ERROR privacy: leak check found " + CAT.leaks + " (this page should not have been published)");
    else out.push(at + "NOTICE privacy: no leak check has run for this page (only a published build runs it)");
    return out.join("\n") + "\n";
  }

  /* ---------- the Today line of the boot log: due or not, never how many (K1) ---------- */
  function todayItems() {
    var G = window.RDG; if (!G || typeof G.todayItems !== "function") return null;
    try { var it = G.todayItems(BY); return Array.isArray(it) ? it : null; } catch (e) { return null; }
  }
  function todayLine() {
    var items = todayItems(); if (!items) return null;
    if (items.some(function (x) { return x && x.k === "reread"; })) return "today: rereads due";
    if (items.some(function (x) { return x && x.k === "daily" && !x.seen; })) return "today: the latest daily report is not opened yet";
    return "today: nothing due";
  }

  var mounted = false;
  R.mount = function () {
    if (mounted) return; mounted = true;
    try { K.mount("/Reading", readingTree(), "readingfs", "reading", "ro"); }
    catch (e) { K.log("reading: could not mount /Reading: " + (K.errstr ? K.errstr(e) : e), "warn"); }
    try { K.mount("/var/log/build.log", K.mknode("f", { read: buildLog, ro: "build", mode: 292, mtime: builtMs, ctime: builtMs }), "buildlog", "build", "ro"); }
    catch (e2) { K.log("reading: could not mount /var/log/build.log: " + (K.errstr ? K.errstr(e2) : e2), "warn"); }
    if (CAT.broken) { K.log("reading: the catalog of this page could not be read", "warn"); return; }
    var bt = builtText();
    K.log("reading: " + plural(nNotes(), "note", "notes") + " in " + plural(nFields(), "field", "fields") + (bt ? ", built " + bt : "") + " (source " + (CAT.source || "unknown") + ")");
    var ls = leakState();
    if (ls === "clean") K.log("privacy: leak check at build 0 (a build that finds any leak is not published)");
    else if (ls === "found") K.log("privacy: leak check at build found " + CAT.leaks, "warn");
    else K.log("privacy: no leak check has run for this page", "warn");
    var tl = todayLine(); if (tl) K.log(tl);
  };

  /* ---------- ~/Library/Logs/reading.log: one tab-separated line per event ---------- */
  function stamp() { var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); }
  R.log = function (event, id) {
    try {
      var n = id != null ? BY[id] : null, clean = function (s) { return String(s == null ? "" : s).replace(/[\t\n\r]+/g, " "); };
      FS.mkdir(HOME + "/Library/Logs", true);
      FS.write(LOGFILE, [stamp(), clean(event), clean(id), clean(n ? n.title : "")].join("\t") + "\n", true);
      // it stays small, as the notification log does: the newest 300 lines once it passes 48 KB
      if (FS.stat(LOGFILE).size > 48 * 1024) FS.write(LOGFILE, FS.read(LOGFILE).split("\n").slice(-301).join("\n"));
    } catch (e) {}
  };
  R.log.file = LOGFILE;

  /* ==========================================================================
     First run: no Terminal. The Shelf is the desktop; one toast says how to search
     ========================================================================== */
  var firstEver = false;
  R.firstRun = function () {
    try { if (!A.prefs.get(PREF, "welcomed", false)) { firstEver = true; A.prefs.set(PREF, "welcomed", true); } } catch (e) {}
  };

  /* ==========================================================================
     Deep links: #n=<id> (Shelf), #k (Spotlight), #today, #r=<id> (Reader)
     ========================================================================== */
  function parseHash(h) {
    h = String(h || "").replace(/^#/, ""); if (!h) return null;
    if (h === "k") return { k: "k" };
    if (h === "today") return { k: "today" };
    var m = /^([nr])=([^&]+)/.exec(h);
    if (!m) return null;
    var id = m[2]; try { id = decodeURIComponent(id); } catch (e) {}
    return { k: m[1], id: id };
  }
  function clearHash() { try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) {} }
  function shelfFrame() { return document.getElementById("rdg-shelf"); }
  function showShelf(id) {
    if (typeof R.showShelf === "function") { try { R.showShelf(id); return; } catch (e) { console.error(e); } }
    // without rdg-shelf.js: the board's own API, when its frame is there
    var f = shelfFrame(), b = null; try { b = f && f.contentWindow && f.contentWindow.RDGBoard; } catch (e) {}
    if (b && id && typeof b.openDetail === "function") { try { b.openDetail(id); } catch (e) {} }
    else if (!f) location.href = "shelf.html" + (id ? "#n=" + encodeURIComponent(id) : "");
  }
  function openNote(id, o) {
    if (typeof R.openNote === "function") { try { return R.openNote(id, o || {}); } catch (e) { console.error(e); } }
    var n = BY[id]; if (n && n.href) location.href = n.href;   // without Reader: the note page itself
  }
  function openToday() {
    if (typeof R.openToday === "function") { try { return R.openToday(); } catch (e) { console.error(e); } }
    var app = A.apps.get("today"); if (app) A.apps.launch(app);
  }
  function openSpotlight() {
    if (!A.spotlight || !A.spotlight.open) return false;
    if (A.spotlight.isOpen && A.spotlight.isOpen()) return true;
    A.spotlight.open("");
    return true;
  }
  function runRoute(r) {
    if (!r) return;
    if (r.k === "k") { setTimeout(openSpotlight, 40); return; }
    if (r.k === "today") { openToday(); return; }
    var known = !!BY[r.id];
    if (!known) A.toast("That note is not in this build of the site");
    if (r.k === "n") showShelf(known ? r.id : undefined);
    else if (known) openNote(r.id, { newWindow: false });
  }
  R.route = function (hash) { runRoute(parseHash(hash)); };

  /* ---------- the boot screen plays once per tab, never under a deep link ---------- */
  function quickBoot() {
    var full = A.shell.boot;
    A.shell.boot = function (done) {
      A.shell.boot = full;
      var el = document.getElementById("boot"); if (el) { el.classList.add("out"); el.hidden = true; }
      done();
    };
  }
  // Restart, Shut down and Power on are a new boot: the boot screen plays again
  A.bus.on("power", function () { ssDel("rdg-os-boot"); });

  function focusShelf() {
    var f = shelfFrame(); if (!f) return;
    try { f.focus({ preventScroll: true }); if (f.contentWindow) f.contentWindow.focus(); } catch (e) {}
  }
  function deskReady(route) {
    var todayOpened = false;
    // the session's windows come back 70 ms apart after this, and each new window closes Spotlight and takes the
    // front: a deep link or Today waits until the last of them is open
    var nWins = 0; try { var s = JSON.parse(lsGet("rdg-os-session") || "null"); nWins = s && s.wins ? s.wins.length : 0; } catch (e) {}
    var after = nWins ? nWins * 70 + 30 : 0;
    var later = function (fn) { if (after) setTimeout(fn, after); else fn(); };
    if (route) { clearHash(); later(function () { runRoute(route); }); }
    else if (window.RDG && typeof window.RDG.bootToday === "function") {
      // the board's rule: the first visit of the local day, and only when something is due (rdg-boot-date)
      try { window.RDG.bootToday(function () { todayOpened = true; later(openToday); }, BY); } catch (e) { console.error(e); }
    }
    // the keyboard: Today when it opened, else the Shelf. Restored windows (70 ms apart) keep it when they come back
    setTimeout(function () {
      if (todayOpened || route || A.shell.locked) return;
      var ae = document.activeElement;
      if (!A.wm.focused() && (!ae || ae === document.body)) focusShelf();
    }, nWins * 70 + 250);
    if (firstEver) setTimeout(function () { A.toast("Press " + CMDK + " to find a note"); }, 300);
  }
  var readied = false;
  R.ready = function () {
    if (readied) return; readied = true;
    var route = parseHash(location.hash);
    if (route || ssGet("rdg-os-boot")) quickBoot();
    ssSet("rdg-os-boot", "1");
    if (A.desktop && A.desktop.ready) deskReady(route);
    else { var off = A.bus.on("desktop:ready", function () { off(); deskReady(route); }); }
    // a link followed while the desktop is up (index.html#r=… typed or clicked) is a route too
    window.addEventListener("hashchange", function () {
      var r = parseHash(location.hash); if (!r) return;
      clearHash();
      if (A.desktop && A.desktop.ready && !A.shell.locked && !A.shell.poweringDown) runRoute(r);
    });
  };

  /* ==========================================================================
     ⌘K (Ctrl-K off Apple) opens Spotlight, except where Terminal keeps it as Clear
     ========================================================================== */
  function isCmdK(e) { return (IS_APPLE ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && (e.code === "KeyK" || String(e.key).toLowerCase() === "k"); }
  function inTerminal(el) { return !!(el && el.closest && el.closest(".term")); }
  // registered after the shell's onKey (atlas-shell.js), so a ⌘K that an app's menu took (Terminal's Clear to start)
  // arrives here already handled
  window.addEventListener("keydown", function (e) {
    if (!isCmdK(e) || e.defaultPrevented || e.isComposing) return;
    if (!A.desktop || !A.desktop.ready || A.shell.locked || A.shell.poweringDown) return;
    if (inTerminal(document.activeElement)) return;
    var app = A.apps.active(); if (app && app.id === "terminal") return;
    if (!A.spotlight || !A.spotlight.open) return;
    e.preventDefault(); e.stopPropagation();
    openSpotlight();
  }, true);
  R.isCmdK = isCmdK;

  /* ==========================================================================
     hookFrame(iframe, win): a same-origin frame (a Reader page, the Shelf) behaves as part of the desk.
     A press inside raises its window; ⌥, ⌃ and ⌘ chords outside text fields reach the shell's keys;
     ⌘K always does. Esc and plain typing stay in the frame. win is the WM window, or a function to call
     on a press (the Shelf), or null.
     ========================================================================== */
  var EDIT_KEYS = /^Key[ZXCVA]$/;   // ⌘Z ⌘X ⌘C ⌘V ⌘A edit the frame's own text and selection
  var MOD_ONLY = { Alt: 1, Control: 1, Meta: 1, Shift: 1, AltGraph: 1 };
  function editable(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName;
    return t === "TEXTAREA" || t === "SELECT" || (t === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|color|file|image)$/i.test(el.type)) || !!el.isContentEditable;
  }
  function forward(type, e) {
    var ev;
    try { ev = new KeyboardEvent(type, { key: e.key, code: e.code, location: e.location, repeat: e.repeat, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, bubbles: true, cancelable: true }); }
    catch (er) { return false; }
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  R.hookFrame = function (iframe, win) {
    if (!iframe) return;
    var raise = function () {
      try { if (A.ui && A.ui.closeMenus) A.ui.closeMenus(); } catch (e) {}
      if (typeof win === "function") { try { win(); } catch (e) { console.error(e); } return; }
      if (win && !win.closing && typeof win.focus === "function" && (A.wm.focused() !== win || win.minimized)) win.focus();
    };
    var h = iframe.__rdgHook;
    if (h) { h.raise = raise; h.attach(); return; }
    h = iframe.__rdgHook = { raise: raise };
    h.down = function () { h.raise(); };
    h.key = function (e) {
      if (e.isComposing || e.keyCode === 229 || MOD_ONLY[e.key]) return;
      if (A.shell.locked || A.shell.poweringDown) return;
      var k = isCmdK(e);
      if (!k) {
        if (!(e.altKey || e.ctrlKey || e.metaKey)) return;                        // plain typing and Esc stay in the frame
        if (editable(e.target)) return;                                           // a text field keeps its chords
        if (e.metaKey && !e.altKey && !e.ctrlKey && EDIT_KEYS.test(e.code)) return; // copy, paste, select all, undo of the page
      }
      if (forward("keydown", e)) { e.preventDefault(); e.stopPropagation(); }
    };
    // the end of a held chord (⌥ for the app switcher) reaches the shell too
    h.up = function (e) { if (MOD_ONLY[e.key]) forward("keyup", e); };
    h.attach = function () {
      var w = null; try { w = iframe.contentWindow; if (w && !w.document) w = null; } catch (e) { w = null; }   // another origin: nothing to hook
      if (!w) return;
      try {
        // the same functions each time, so a window object kept across a navigation is never hooked twice
        w.removeEventListener("pointerdown", h.down, true); w.addEventListener("pointerdown", h.down, true);
        w.removeEventListener("keydown", h.key, true); w.addEventListener("keydown", h.key, true);
        w.removeEventListener("keyup", h.up, true); w.addEventListener("keyup", h.up, true);
      } catch (e) {}
    };
    iframe.addEventListener("load", h.attach);
    h.attach();
  };

  /* ==========================================================================
     Reading depth (rdg-depth, read by site_depth.js in every note page)
     ========================================================================== */
  function getDepth() { var v = lsGet("rdg-depth"); return DEPTHS.indexOf(v) >= 0 ? v : "All"; }
  function frameWindows() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) { try { if (f.contentWindow && f.contentWindow.document) out.push(f.contentWindow); } catch (e) {} });
    return out;
  }
  function setDepth(v) {
    if (DEPTHS.indexOf(v) < 0 || v === getDepth()) return;
    lsSet("rdg-depth", v); changed("rdg-depth");
    // open Readers follow at once (their pages also hear the storage event)
    frameWindows().forEach(function (w) { try { if (w.RDGDepth && typeof w.RDGDepth.set === "function") w.RDGDepth.set(v); } catch (e) {} });
  }
  R.depth = { get: getDepth, set: setDepth, levels: function () { return DEPTHS.slice(); } };

  /* ==========================================================================
     Reading data: every rdg- key in this browser, Copy as JSON (K9), two-step Remove
     ========================================================================== */
  function readingKeys() { return lsKeys().filter(function (k) { return !own(OS_KEYS, k); }); }
  function readingBytes() { return readingKeys().reduce(function (t, k) { return t + lsBytes(k); }, 0); }
  function hsize(n) { return A.ui && A.ui.hsize ? A.ui.hsize(n) : n + " bytes"; }
  function exportJSON() {
    var keys = {};
    readingKeys().forEach(function (k) { var v = lsGet(k); if (v == null) return; try { keys[k] = JSON.parse(v); } catch (e) { keys[k] = v; } });
    return JSON.stringify({ format: "reading-data", v: 1, exported: new Date().toISOString(), keys: keys }, null, 2) + "\n";
  }
  function copyText(text, done) {
    var legacy = function () {
      var ta = document.createElement("textarea"), prev = document.activeElement, ok = false;
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove(); try { if (prev && prev.focus) prev.focus({ preventScroll: true }); } catch (e) {}
      return ok;
    };
    var p = null; try { if (navigator.clipboard && navigator.clipboard.writeText) p = navigator.clipboard.writeText(text); } catch (e) { p = null; }
    if (p && p.then) p.then(function () { done(true); }, function () { done(legacy()); });
    else done(legacy());
  }
  R.copyData = function () {
    copyText(exportJSON(), function (ok) { A.toast(ok ? "Reading data copied as JSON" : "Could not copy: this browser blocked the clipboard"); });
  };
  R.removeData = function () {
    var keys = readingKeys();
    keys.forEach(lsDel);
    keys.forEach(changed);
    return keys.length;
  };
  A.css("rdg-system", [
    ".rdg-data { display: grid; gap: 14px; max-height: min(46vh, 380px); overflow-y: auto; overscroll-behavior: contain }",
    ".rdg-data ul { list-style: none; margin: 6px 0 0; padding: 0 }",
    ".rdg-data li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 5px 0; border-top: 1px solid var(--line) }",
    ".rdg-data li .k { font: 500 12px/16px var(--mono); overflow-wrap: anywhere; user-select: text; -webkit-user-select: text }",
    ".rdg-data li .k small { font: 500 11px/16px var(--sans); color: var(--muted); margin-left: 8px }",
    ".rdg-data li .sz { flex: none; font: 500 12px/16px var(--mono); color: var(--muted) }",
    ".rdg-data .none, .rdg-data .note { margin: 6px 0 0; font-size: 12px; line-height: 17px; color: var(--muted) }",
    ".sheet.rdg-data-sheet .sheet-f { flex-wrap: wrap }",
    ".cc-rdgdata .mono { font: 500 12px/16px var(--mono) }",
    // five depths beside the label in a 320 px panel: narrower buttons, so the label is not covered
    ".cc-row[data-id=\"rdgdepth\"] .seg button { padding: 4px 6px; min-width: 0 }"
  ].join("\n"));
  R.dataSheet = function () {
    var body = A.el("div", "rdg-data"), rk = readingKeys();
    var rows = function (keys, label) {
      return keys.map(function (k) { return '<li><span class="k">' + esc(k) + (label && label[k] ? "<small>" + esc(label[k]) + "</small>" : "") + '</span><span class="sz">' + esc(hsize(lsBytes(k))) + "</span></li>"; }).join("");
    };
    var osk = Object.keys(OS_KEYS).filter(function (k) { return lsGet(k) != null; });
    body.innerHTML =
      '<section><span class="lbl">Reading</span>' + (rk.length ? "<ul>" + rows(rk) + "</ul>" : '<p class="none">Nothing is kept yet.</p>') + "</section>" +
      '<section><span class="lbl">This desktop</span>' + (osk.length ? "<ul>" + rows(osk, OS_KEYS) + "</ul>" : '<p class="none">Nothing is kept yet.</p>') +
      '<p class="note">Erase and restart removes only these two. Copy as JSON and Remove reading data cover the Reading keys above.</p></section>';
    var s = A.ui.sheet(null, { title: "Reading data", message: "Progress, rereads, highlights and settings are kept in this browser only, under keys that start with rdg-.", body: body,
      buttons: [
        { label: "Remove reading data", danger: true, run: function () { var n = R.removeData(); A.toast(n ? "Reading data removed" : "There was no reading data to remove"); } },
        { label: "Copy as JSON", run: function () { R.copyData(); return false; } },
        { label: "Done", primary: true, value: null }] });
    if (s && s.el) s.el.classList.add("rdg-data-sheet");
    return s;
  };

  /* ---------- Control Center rows (P12): built each time the panel opens ---------- */
  R.ccRows = function () {
    return [
      { id: "rdgdepth", label: "Reading depth", value: getDepth, line: function () { return ""; },
        build: function (ctl) {
          var seg = null;
          seg = A.ui.segmented(DEPTHS.map(function (v) { return { value: v, label: v, title: DEPTH_TITLE[v] }; }), getDepth(), function (v) {
            var a = document.activeElement, kept = !a || a === document.body || seg.contains(a);
            setDepth(v);
            // the buttons are drawn again on each press: the keyboard stays on the one pressed
            if (kept) { var b = seg.querySelector('[data-v="' + v + '"]'); if (b) try { b.focus({ preventScroll: true }); } catch (e) {} }
          });
          seg.setAttribute("aria-label", "Reading depth"); ctl.appendChild(seg);
        } },
      { id: "rdgdata", label: "Reading data…", value: function () { return null; }, line: function () { return ""; },
        build: function (ctl) {
          var b = A.el("button", "cc-disk cc-rdgdata", '<span class="mono"></span>'); b.type = "button";
          var sz = hsize(readingBytes());
          b.querySelector(".mono").textContent = sz;
          b.title = "What is kept in this browser"; b.setAttribute("aria-label", "Reading data: " + sz + ". Show the keys");
          b.addEventListener("click", function () { try { A.center.closeControl(); } catch (e) {} R.dataSheet(); });
          ctl.appendChild(b);
        } }
    ];
  };

  /* ==========================================================================
     About Reading OS (Atlas menu, P6): the build's facts, as /var/log/build.log has them
     ========================================================================== */
  R.about = function () {
    var ex = A.wm.list().filter(function (w) { return w.el.classList.contains("about-reading"); })[0]; if (ex) { ex.focus(); return ex; }
    var d = daily(), ls = leakState(), disk = 0; try { disk = K.store.diskSize ? K.store.diskSize() : K.store.size(); } catch (e) {}
    var kv = [
      ["Built", builtText() || "unknown"],
      ["Source", CAT.source || "unknown"],
      ["Notes", String(nNotes())],
      ["Folders", String(nDirs())],
      ["Fields", String(nFields())],
      ["Daily", d ? d.date : "none yet"],
      ["Leak check", ls === "clean" ? "0, at build" : ls === "found" ? String(CAT.leaks) + ", at build" : "not run for this page"],
      ["Disk image", hsize(disk)],
      ["Reading data", hsize(readingBytes())]
    ];
    var body = A.el("div", "about-atlas-b");
    body.innerHTML = '<div class="ab-logo">' + A.icon("atlas", 64) + '</div><div class="ab-t">Reading OS</div><div class="lbl">Atlas OS 0.2.2 · kernel ' + esc(K.version + "-" + K.codename) + "</div>" +
      '<dl class="ab-kv">' + kv.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>";
    var foot = A.el("div", "ab-f");
    foot.appendChild(A.ui.button("Build log…", { onClick: function () { try { A.open("/var/log/build.log"); A.history.add("open /var/log/build.log", "Atlas"); } catch (e) { A.toast(K.errstr(e)); } } }));
    foot.appendChild(A.ui.button("Reading data…", { onClick: function () { R.dataSheet(); } }));
    body.appendChild(foot);
    return A.wm.create({ app: A.apps.get("finder"), title: "", w: 320, h: 520, resizable: false, cls: "about-atlas about-reading bare", body: body });
  };
})(window.ATLAS = window.ATLAS || {});
