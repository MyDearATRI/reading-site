/* Reading OS · Reader
   One note per window. The window body is an <iframe> of the note's own static page (same origin),
   so the page keeps its depth control (depth.js), its highlights and margin notes (desk.js), KaTeX
   and Mermaid, and a highlight made here is the same rdg-desk:<id> entry the standalone page reads.
   The Reader never writes to a note (K3).

   A.reading.openNote(id, {newWindow})   a window showing that note comes forward; otherwise a new
                                         window opens. Under 720 px the tab goes to the plain page.
   A.reading.openPage(url, o)            the same for any page of the site (folder pages included).
   A.reading.readers()                   [{win, frame, id, url}] for every open Reader window.

   Each window keeps its own Back/Forward list and navigates its frame with location.replace, so one
   window's Back never steps another window (iframes share the tab's history otherwise).
   Links inside the page reach the Reader through assets/embed.js (frameElement.rdgReader.go).
   Keys and clicks inside the frame reach the OS through A.reading.hookFrame(iframe, win), called once
   for every page the frame loads (a new page is a new window object). A local relay with the same
   rules stands in when hookFrame is not there.

   Window state for the session: {id, path} (path is the page's address relative to the site root). */
(function (A) {
  "use strict";
  var K = A.K, FS = K.fs;
  var R = A.reading = A.reading || {};
  var IS_APPLE = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  var BASE = new URL(".", location.href).href;          // the site root: index.html lives there
  var SITE_TITLE = / · Reading$/;

  /* ---------- an open-book glyph for the Dock and the menus ---------- */
  if (A.icons && !A.icons.reader) {
    A.icons.reader = '<path d="M12 6.6C10 5 7.4 4.6 4 4.8v12.6c3.4-.2 6 .2 8 1.8 2-1.6 4.6-2 8-1.8V4.8c-3.4-.2-6 .2-8 1.8zM12 6.6v12.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  A.css("rdg-reader", [
    /* title bar: ‹ › on the left, the title, then depth and the two page actions (Preview's layout) */
    ".win.rdg-rd-win.has-toolbar .win-bar { grid-template-columns: auto auto minmax(0, 1fr) auto }",
    ".win.rdg-rd-win.has-toolbar .win-tools, .rdg-rd-tb { display: contents }",
    ".rdg-rd-nav { order: 1 } .win.rdg-rd-win.has-toolbar .win-title { order: 2; padding-left: 2px } .rdg-rd-acts { order: 3 }",
    ".rdg-rd-nav, .rdg-rd-acts { display: flex; align-items: center; gap: 2px; min-width: 0 }",
    ".rdg-rd-acts { gap: 6px }",
    ".rdg-rd-acts .seg button { padding: 4px 8px; min-width: 26px; font-variant-numeric: tabular-nums }",
    ".win.rdg-rd-win.rdg-tight .rdg-rd-acts .seg { display: none }",
    /* the page: the note's own paper colour, so nothing flashes white while it loads */
    ".win.rdg-rd-win .win-body { background: #f7f6f0 }",
    ".rdg-rd-body { position: absolute; inset: 0 }",
    ".rdg-rd-body iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #f7f6f0; transition: opacity .16s var(--ease) }",
    ".rdg-rd-body.loading iframe { opacity: 0 }",
    ".rdg-rd-body .rdg-rd-wait { position: absolute; left: 0; right: 0; top: 38%; text-align: center; font: 500 12.5px/16px var(--sans); color: var(--muted); opacity: 0; transition: opacity .2s var(--ease) .25s; pointer-events: none }",
    ".rdg-rd-body.loading .rdg-rd-wait { opacity: 1 }",
    "#os.reduce .rdg-rd-body iframe, #os.reduce .rdg-rd-body .rdg-rd-wait { transition: none }",
    "@media (prefers-reduced-motion: reduce) { .rdg-rd-body iframe, .rdg-rd-body .rdg-rd-wait { transition: none } }"
  ].join("\n"));

  /* ---------- the catalog (rdg-system owns it; the page's own JSON is the fallback) ---------- */
  var ownCat = null, byHref = null, byPath = null;
  function catalog() {
    var c = R.catalog;
    try { if (typeof c === "function") c = c(); } catch (e) { c = null; }
    if (c && c.notes) return c;
    if (!ownCat) {
      try { ownCat = JSON.parse(document.getElementById("rdg-catalog").textContent); } catch (e) { ownCat = null; }
      if (!ownCat || !ownCat.notes) ownCat = { notes: [], dirs: [] };
    }
    return ownCat;
  }
  function note(id) {
    if (!id) return null;
    if (typeof R.byId === "function") { try { var n = R.byId(id); if (n) return n; } catch (e) {} }
    var list = catalog().notes;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function nfc(s) { try { return String(s).normalize("NFC"); } catch (e) { return String(s); } }
  function keyOf(url) { try { var u = new URL(url, BASE); return nfc(decodeURIComponent(u.pathname)); } catch (e) { return ""; } }
  function indexes() {
    if (byHref) return;
    byHref = {}; byPath = {};
    catalog().notes.forEach(function (n) {
      if (n.href) byHref[keyOf(n.href)] = n;
      if (n.path) byPath[nfc(n.path)] = n;
    });
  }
  function noteAtUrl(url) { indexes(); return byHref[keyOf(url)] || null; }
  function noteUrl(n) { return new URL(n.href, BASE).href; }
  function moc() {
    var list = catalog().notes;
    for (var i = 0; i < list.length; i++) if (/^00_MOC/.test(nfc(list[i].path || ""))) return list[i];
    return list[0] || null;
  }

  // a site page: same origin, under the site root; never the OS index or the shelf
  function sitePage(url) {
    var u;
    try { u = new URL(url, BASE); } catch (e) { return null; }
    if (u.origin !== location.origin || u.href.indexOf(BASE) !== 0) return null;
    return u;
  }
  function isOsUrl(url) {
    var u = sitePage(url); if (!u) return false;
    var rootPath = new URL(BASE).pathname, p = u.pathname;
    return p === rootPath || p === rootPath + "index.html" || p === rootPath + "shelf.html";
  }
  function relOf(url) { return url && url.indexOf(BASE) === 0 ? url.slice(BASE.length) : null; }
  function bare(url) { var i = String(url || "").indexOf("#"); return i < 0 ? String(url || "") : String(url).slice(0, i); }

  /* ---------- the key and click relay into the OS ---------- */
  function editable(t) {
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }
  var MODS = { Alt: 1, Control: 1, Meta: 1, Shift: 1, AltGraph: 1, CapsLock: 1, Fn: 1 };
  function relay(iframe, w) {
    var cw = iframe.contentWindow;
    cw.addEventListener("pointerdown", function () {
      if (w.closing) return;
      if (A.ui && A.ui.closeMenus) A.ui.closeMenus();
      if (A.spotlight && A.spotlight.isOpen && A.spotlight.isOpen() && A.spotlight.close) A.spotlight.close();
      if (A.wm.focused() !== w) w.focus();
    }, true);
    cw.addEventListener("keydown", function (e) {
      if (MODS[e.key]) return;
      var cmdK = (IS_APPLE ? e.metaKey : e.ctrlKey) && !e.altKey && e.code === "KeyK";
      if (!cmdK) {
        if (!(e.altKey || e.ctrlKey || e.metaKey)) return;        // Esc and plain typing stay in the page
        if (e.isComposing || e.keyCode === 229 || editable(e.target)) return;
      }
      var ev;
      try {
        ev = new KeyboardEvent("keydown", { key: e.key, code: e.code, location: e.location, repeat: e.repeat,
          altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, bubbles: true, cancelable: true });
      } catch (er) { return; }
      window.dispatchEvent(ev);
      if (ev.defaultPrevented) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }
  function hook(r) {
    var cw; try { cw = r.frame.contentWindow; } catch (e) { return; }
    if (!cw || cw.__rdgHooked) return;
    cw.__rdgHooked = true;
    try {
      if (typeof R.hookFrame === "function") R.hookFrame(r.frame, r.win);
      else relay(r.frame, r.win);
    } catch (e) { console.error(e); }
  }

  /* ---------- one Reader window ---------- */
  function ensureEmbed(doc, cw) {
    // a page built without assets/embed.js (older folder pages): hide its own bar at once, then add the layer
    if (cw.RDGEmbed || !doc.querySelector("header.bar")) return;
    doc.documentElement.classList.add("rdg-embedded");
    var st = doc.createElement("style");
    st.setAttribute("data-rdg-ui", "embed");
    st.textContent = "html.rdg-embedded header.bar, html.rdg-embedded footer.site { display: none !important; }";
    (doc.head || doc.documentElement).appendChild(st);
    var s = doc.createElement("script");
    s.src = BASE + "assets/embed.js";
    (doc.head || doc.documentElement).appendChild(s);
  }

  function makeWindow(app, url, o) {
    o = o || {};
    var n0 = noteAtUrl(url);
    var r = { hist: [url], pos: 0, id: n0 ? n0.id : null, url: url, title: n0 ? n0.title : "Reader", depthOff: null, doc: null };

    var body = A.el("div", "rdg-rd-body loading");
    var frame = A.el("iframe");
    frame.setAttribute("allow", "clipboard-write; fullscreen");
    frame.title = r.title;
    body.appendChild(frame);
    body.appendChild(A.el("div", "rdg-rd-wait", "Opening…"));
    r.frame = frame; r.body = body;

    var tb = A.el("div", "rdg-rd-tb"), nav = A.el("div", "rdg-rd-nav"), acts = A.el("div", "rdg-rd-acts");
    var bBack = A.ui.iconButton("back", "Back (⌥[)", function () { back(r); });
    var bFwd = A.ui.iconButton("forward", "Forward (⌥])", function () { forward(r); });
    var segBox = A.el("div", "rdg-rd-depth");
    var bShelf = A.ui.iconButton(A.icons.shelf ? "shelf" : "grid", "Find on Shelf", function () { findOnShelf(r); });
    var bPage = A.ui.iconButton("share", "Open as page", function () { openAsPage(r); });
    nav.appendChild(bBack); nav.appendChild(bFwd);
    acts.appendChild(segBox); acts.appendChild(bShelf); acts.appendChild(bPage);
    tb.appendChild(nav); tb.appendChild(acts);
    r.ui = { back: bBack, fwd: bFwd, seg: segBox, shelf: bShelf, page: bPage };

    var wa = A.wm.workArea();
    var w = A.wm.create({
      app: app, title: r.title, cls: "rdg-rd-win", body: body, toolbar: tb,
      w: o.w || Math.min(880, wa.w - 40), h: o.h || Math.min(1000, Math.max(420, wa.h - 48)),
      x: o.x, y: o.y, minW: 380, minH: 300, focus: o.focus,
      onResize: function (win) { win.el.classList.toggle("rdg-tight", win.w < 600); },
      onFocus: function (win) {
        var a = document.activeElement;
        if (a && win.el.contains(a) && a !== frame) return;      // a toolbar button keeps the keyboard
        try { frame.contentWindow.focus(); } catch (e) {}
      },
      onClosed: function () {
        clearTimeout(r.revealT); cancelAnimationFrame(r.poll);
        if (r.depthOff) r.depthOff();
        try { frame.rdgReader = null; } catch (e) {}
      }
    });
    r.win = w; w.rdr = r; w.kind = "reader";
    w.el.classList.toggle("rdg-tight", w.w < 600);
    frame.rdgReader = { go: function (u) { go(r, u, true); } };
    frame.addEventListener("load", function () { loaded(r); });
    setDoc(r);
    sync(r);
    startLoading(r);
    frame.src = url;
    return w;
  }

  function setDoc(r) {
    var n = note(r.id);
    if (n && n.path) { r.win.doc = "/Reading/" + n.path + ".note"; r.win.titleEl.title = r.win.doc; }
    else { r.win.doc = null; r.win.titleEl.title = ""; }
  }

  function startLoading(r) {
    r.body.classList.add("loading");
    clearTimeout(r.revealT); cancelAnimationFrame(r.poll);
    var prev = null; try { prev = r.frame.contentDocument; } catch (e) {}
    // the page shows as soon as its embed layer has hidden the site bar, at the latest on load (or after 2.5 s)
    var tick = function () {
      var d = null; try { d = r.frame.contentDocument; } catch (e) {}
      if (d && d !== prev && d.documentElement && d.documentElement.classList.contains("rdg-embedded")) { reveal(r); return; }
      r.poll = requestAnimationFrame(tick);
    };
    r.poll = requestAnimationFrame(tick);
    r.revealT = setTimeout(function () { reveal(r); }, 2500);
  }
  function reveal(r) { clearTimeout(r.revealT); cancelAnimationFrame(r.poll); r.body.classList.remove("loading"); }

  function go(r, url, push) {
    var u = sitePage(url);
    if (!u) { window.open(url, "_blank", "noopener"); return; }
    if (isOsUrl(u.href)) { if (typeof R.showShelf === "function") R.showShelf(); return; }
    var href = u.href, cur = r.hist[r.pos];
    if (push) { r.hist = r.hist.slice(0, r.pos + 1); if (href !== cur) r.hist.push(href); r.pos = r.hist.length - 1; }
    var cw = null; try { cw = r.frame.contentWindow; } catch (e) {}
    var sameDoc = false; try { sameDoc = !!cw && bare(cw.location.href) === bare(href); } catch (e) {}
    if (!sameDoc) startLoading(r);
    try { cw.location.replace(href); } catch (e) { r.frame.src = href; }
    if (sameDoc) { r.url = href; sync(r); saveSoon(); }
  }
  function back(r) { if (r.pos > 0) { r.pos--; go(r, r.hist[r.pos], false); } }
  function forward(r) { if (r.pos < r.hist.length - 1) { r.pos++; go(r, r.hist[r.pos], false); } }

  function loaded(r) {
    if (r.win.closing) return;
    var cw, doc, href;
    try { cw = r.frame.contentWindow; doc = cw.document; href = cw.location.href; } catch (e) { reveal(r); return; }
    if (!href || href === "about:blank") return;
    // the OS itself in the frame (a page without the embed layer linked to it): put the last page back
    if (isOsUrl(href) || (cw.ATLAS && cw.ATLAS !== A)) {
      var prev = r.hist[r.pos];
      if (prev && !isOsUrl(prev)) { try { cw.location.replace(prev); } catch (e) { r.frame.src = prev; } }
      if (typeof R.showShelf === "function") R.showShelf();
      return;
    }
    // where the frame really is: a navigation the Reader did not start goes on the list
    if (bare(r.hist[r.pos]) === bare(href)) r.hist[r.pos] = href;
    else { r.hist = r.hist.slice(0, r.pos + 1); r.hist.push(href); r.pos = r.hist.length - 1; }
    r.url = href;
    var n = noteAtUrl(href);
    r.id = (doc.body && doc.body.getAttribute("data-note")) || (n ? n.id : null);
    // reading the latest daily report is seeing it, as opening it on the board is (Today and the boot check follow)
    if (r.id && window.RDG && typeof window.RDG.markDaily === "function") { try { window.RDG.markDaily(r.id); } catch (e) {} }
    r.title = String(doc.title || (n && n.title) || "Reader").replace(SITE_TITLE, "");
    r.frame.title = r.title;
    r.doc = doc;
    ensureEmbed(doc, cw);
    hook(r);
    if (r.depthOff) r.depthOff();
    var onDepth = function () { depthUI(r); };
    doc.addEventListener("rdg:depth", onDepth);
    r.depthOff = function () { try { doc.removeEventListener("rdg:depth", onDepth); } catch (e) {} r.depthOff = null; };
    setDoc(r);
    r.win.setTitle(r.title);
    sync(r);
    reveal(r);
    // the keyboard follows the page when this is the key window
    if (A.wm.focused() === r.win) { var a = document.activeElement; if (!a || a === document.body || a === r.frame) { try { cw.focus(); } catch (e) {} } }
    saveSoon();
  }

  /* ---------- the toolbar and the menus read the same state ---------- */
  function depthOf(r) {
    try { var d = r.frame.contentWindow.RDGDepth; if (d && d.levels) return d; } catch (e) {}
    return null;
  }
  function depthUI(r) {
    var d = depthOf(r), lv = d ? d.levels() : [], cur = d ? d.get() : "All";
    var key = lv.join(",") + "|" + cur;
    if (r.segKey === key) return;
    r.segKey = key;
    r.ui.seg.replaceChildren();
    if (lv.length < 2) return;
    var opts = lv.map(function (v) { return { value: v, label: v, title: "Read to " + v }; }).concat([{ value: "All", label: "All", title: "Show every level" }]);
    var seg = A.ui.segmented(opts, cur, function (v) { var dd = depthOf(r); if (dd) dd.set(v); });
    seg.setAttribute("aria-label", "Reading depth");
    r.ui.seg.appendChild(seg);
  }
  function sync(r) {
    r.ui.back.disabled = r.pos <= 0;
    r.ui.fwd.disabled = r.pos >= r.hist.length - 1;
    r.ui.shelf.disabled = !r.id || typeof R.showShelf !== "function";
    depthUI(r);
    if (r.win.app) A.bus.emit("app:changed", r.win.app);
  }
  function findOnShelf(r) { if (r.id && typeof R.showShelf === "function") R.showShelf(r.id); }
  function openAsPage(r) { var u = r.url || r.hist[r.pos]; if (u) window.open(u, "_blank", "noopener"); }

  var saveT = 0;
  function saveSoon() { clearTimeout(saveT); saveT = setTimeout(function () { if (A.session && A.session.save) A.session.save(); }, 400); }

  /* ---------- opening ---------- */
  function readerWins() {
    var app = A.apps.get("reader"); if (!app) return [];
    return app.windowsList().filter(function (w) { return w.rdr && !w.closing; }).sort(function (a, b) { return (b.lastFocus || 0) - (a.lastFocus || 0); });
  }
  function front() { var f = A.wm.focused(); return f && f.rdr && !f.closing ? f : null; }

  function openUrl(url, o) {
    o = o || {};
    var u = sitePage(url);
    if (!u || isOsUrl(u.href)) return null;
    // a phone gets the plain page, with the browser's own Back
    if (A.wm.narrow()) { location.href = u.href; return null; }
    var app = A.apps.get("reader"); if (!app) return null;
    if (!o.newWindow) {
      var have = readerWins().filter(function (w) { return bare(w.rdr.url || w.rdr.hist[w.rdr.pos]) === bare(u.href); })[0];
      if (have) { if (u.hash && have.rdr.url !== u.href) go(have.rdr, u.href, true); have.focus(); A.apps.setActive(app); return have; }
    }
    app.running = true;
    var w = makeWindow(app, u.href, o);
    A.apps.setActive(app);
    return w;
  }
  R.openNote = function (id, o) {
    var n = note(id);
    if (!n || !n.href) { if (A.toast) A.toast("No note with that id."); return null; }
    return openUrl(noteUrl(n), o);
  };
  R.openPage = function (url, o) { return openUrl(url, o); };
  R.readers = function () { return readerWins().map(function (w) { return { win: w, frame: w.rdr.frame, id: w.rdr.id, url: w.rdr.url }; }); };
  // the Control Center's depth row (or anyone) can push a depth to every open Reader
  A.bus.on("rdg:depth", function (v) {
    readerWins().forEach(function (w) { var d = depthOf(w.rdr); if (d) { try { d.set(v, { persist: false }); } catch (e) {} } });
  });

  // a /Reading stub (or ~/Reading, a link to it) names its note by path, and its Page: line by address
  function noteForFile(path) {
    var abs = path; try { abs = FS.realpath(path); } catch (e) {}
    var m = /^\/Reading\/(.+)\.note$/.exec(abs);
    if (m) { indexes(); var n = byPath[nfc(m[1])]; if (n) return n; }
    try {
      var pm = /^Page: \/?(.+)$/m.exec(FS.read(abs));
      if (pm) return noteAtUrl(new URL(pm[1].trim(), BASE).href);
    } catch (e) {}
    return null;
  }

  function stateUrl(st) {
    st = st || {};
    if (typeof st.path === "string" && st.path && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(st.path)) {
      var u = sitePage(BASE + st.path.replace(/^\/+/, ""));
      if (u && !isOsUrl(u.href)) return u.href;
    }
    var n = note(st.id);
    return n && n.href ? noteUrl(n) : null;
  }

  /* ---------- the app ---------- */
  var ex = function (cmd) { return function () { var f = front(); if (!f || !f.rdr.doc) return; try { f.rdr.frame.contentWindow.focus(); f.rdr.doc.execCommand(cmd); } catch (e) {} }; };
  A.apps.register({
    id: "reader", name: "Reader", icon: "reader", accent: "#3f5f7a", order: 3, quitWhenLastWindowCloses: true,
    desc: "Reads one note per window: the note's own page with its depth control, highlights and margin notes.",
    handles: function (abs) {
      var p = abs; try { p = FS.realpath(abs); } catch (e) {}
      return /^\/Reading\/.+\.note$/.test(p) ? 100 : 0;
    },
    launch: function (app, args) {
      args = args || {};
      if (args.id) return R.openNote(args.id, args);
      if (args.url) return openUrl(args.url, args);
      var m = moc();
      if (m) return R.openNote(m.id, args);
    },
    reopen: function (app, args) {
      if (args && args.id) { R.openNote(args.id, args); return; }
      if (args && args.url) { openUrl(args.url, args); return; }
      return false;
    },
    openFile: function (app, path, args) {
      var n = noteForFile(path);
      if (n) R.openNote(n.id, { newWindow: !!(args && args.newWindow) });
      else if (A.toast) A.toast("Reader opens only the notes in /Reading.");
    },
    saveState: function (w) {
      var r = w.rdr; if (!r) return null;
      var path = relOf(r.url || r.hist[r.pos]);
      return path || r.id ? { id: r.id || null, path: path } : null;
    },
    restore: function (app, st, f) {
      if (A.wm.narrow()) return;                  // a phone opens notes as plain pages, never at boot
      var url = stateUrl(st); if (!url) return;
      app.running = true;
      makeWindow(app, url, f ? { x: f.x, y: f.y, w: f.w, h: f.h } : {});
    },
    menus: function () {
      // what a menu item runs, as a shell line (shown on a rest or with ⌥, kept in ~/.sh_history), only where a
      // command does the same thing: Find on Shelf and Today. open on a stub reuses a window that shows the note and
      // A.open passes no -n to Reader, so the items that always open or navigate a window have none
      var w = front(), r = w ? w.rdr : null, d = r ? depthOf(r) : null, lv = d ? d.levels() : [], cur = d ? d.get() : null;
      var m = moc();
      return [
        { title: "File", items: [
          { label: "Open map of content", disabled: !m, run: function () { if (m) R.openNote(m.id, { newWindow: true }); } }, "-",
          { label: "Find on Shelf", disabled: !r || !r.id || typeof R.showShelf !== "function", cmd: r && r.id ? "shelf note " + r.id : "", run: function () { if (r) findOnShelf(r); } },
          { label: "Open as page", disabled: !r, run: function () { if (r) openAsPage(r); } }] },
        { title: "Edit", items: [
          { label: "Copy", key: "⌘C", disabled: !r, run: ex("copy") },
          { label: "Select all", key: "⌘A", disabled: !r, run: ex("selectAll") }] },
        { title: "View", items: [{ header: "Reading depth" }].concat(
          (lv.length > 1 ? lv.concat(["All"]) : ["All"]).map(function (v) {
            return { label: v === "All" ? "All levels" : v, checked: !!r && cur === v, disabled: lv.length < 2,
              run: function () { var dd = r && depthOf(r); if (dd) dd.set(v); } };
          })) },
        { title: "Go", items: [
          { label: "Back", key: "⌥[", disabled: !r || r.pos <= 0, run: function () { if (r) back(r); } },
          { label: "Forward", key: "⌥]", disabled: !r || r.pos >= r.hist.length - 1, run: function () { if (r) forward(r); } }, "-",
          { label: "Map of content", disabled: !r || !m, run: function () { if (r && m) go(r, noteUrl(m), true); } },
          { label: "Today", hidden: typeof R.openToday !== "function", cmd: "today", run: function () { R.openToday(); } }] }
      ];
    }
  });
})(window.ATLAS = window.ATLAS || {});
