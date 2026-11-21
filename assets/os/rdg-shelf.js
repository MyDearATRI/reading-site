/* Reading OS · rdg-shelf.js
   The Shelf app: the MMLA board (shelf.html?os) is the desktop layer. It sits in #desktop, under #windows, so
   every window floats above it; it has no windows of its own and cannot be quit (plan section 2).
   - Clicking it, or its Dock tile, makes Shelf the app in front (its menus: View and Go).
   - Hide Shelf (⌥H) shows the paper desktop with its icons; the Dock tile or Show all brings it back.
   - Keys pressed inside it with ⌥, ⌃ or ⌘ (outside a text field) go to the OS, so ⌥Space, ⌃⌥← and the menu
     shortcuts work there too, and so does the release of a modifier (⌥Tab switches when ⌥ comes up). The board
     itself sends ⌘K to the OS Spotlight.
   - A.reading.showShelf(id?), A.reading.filterTray(s) and A.reading.showField(ch) drive it from elsewhere
     (deep links, Spotlight, Reader). The board answers through window.RDGBoard (atlas/board.html). */
(function (A) {
  "use strict";
  if (!A || !A.apps || !A.wm) return;
  var RDG = window.RDG;
  var R = A.reading = A.reading || {};
  var SRC = "shelf.html?os";

  // the Shelf glyph of Atlas After Hours (game.js): three books and a shelf
  if (A.icons) A.icons.shelf = '<g fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"><path d="M3 4h4v15H3zM9 6h3v13H9zM14 5l3-1 4 14-3 1zM2 21h20"/></g>';

  A.css("rdg-shelf",
    "#rdg-shelf { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; margin: 0; padding: 0; display: block; background: var(--board); color-scheme: light }\n" +
    // no z-index: last in #desktop, it covers the icons by order alone and stays under every window, also one
    // opened without the focus (a window gets its z-index only when it is raised)
    "#rdg-shelf[hidden] { display: none }\n" +
    "#rdg-shelf:focus, #rdg-shelf:focus-visible { outline: none }\n");

  /* ---------- the frame ---------- */
  var frame = null, hidden = false, queue = [], hookedWin = null;
  function board() { try { var w = frame && frame.contentWindow; return w && w.RDGBoard ? w.RDGBoard : null; } catch (e) { return null; } }
  // run fn(RDGBoard) now, or once the board has loaded
  function withBoard(fn) { var b = board(); if (b) { try { fn(b); } catch (e) { console.error(e); } } else queue.push(fn); }
  function flush() { var b = board(); if (!b) return; var q = queue; queue = []; q.forEach(function (fn) { try { fn(b); } catch (e) { console.error(e); } }); }
  function insets() {
    var top = 40, bottom = 80;
    try { top = A.menubar && A.menubar.height ? A.menubar.height() + 6 : 40; } catch (e) {}
    try { bottom = A.dock && A.dock.reserve ? A.dock.reserve() : 80; } catch (e) {}
    return { top: top, bottom: bottom };
  }
  function pushInsets() { var i = insets(); withBoard(function (b) { if (b.insets) b.insets(i.top, i.bottom); }); }
  function make() {
    if (frame) return frame;
    var desk = document.getElementById("desktop"); if (!desk) return null;
    frame = document.createElement("iframe");
    frame.id = "rdg-shelf"; frame.src = SRC; frame.title = "Shelf";
    frame.setAttribute("aria-label", "Shelf: every note on one board");
    frame.addEventListener("load", hook);
    desk.appendChild(frame);
    return frame;
  }
  function editable(t) {
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
    var tag = t.tagName; if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return false;
    return !/^(button|checkbox|radio|range|color|file|submit|reset|image)$/i.test(t.type || "");
  }
  function hook() {
    var w; try { w = frame.contentWindow; if (!w || !w.document) return; } catch (e) { return; }
    if (hookedWin !== w) {
      hookedWin = w;
      // a press anywhere on the board: Shelf is the app in front, and what floats over the desk closes
      w.addEventListener("pointerdown", function () { activate(); }, true);
      w.addEventListener("focus", function () { if (A.apps.active() !== app && !(A.shell && A.shell.locked)) activate(); });
      // ⌥, ⌃ and ⌘ chords outside a text field go to the OS, as if pressed on the desk
      w.addEventListener("keydown", function (e) {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
        if (!(e.altKey || e.ctrlKey || e.metaKey)) return;
        if (/^(Alt|Control|Meta|Shift)$/.test(e.key)) return;
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyK") return;   // the board opens Spotlight itself
        if (editable(e.target)) return;
        var ev;
        try { ev = new KeyboardEvent("keydown", { key: e.key, code: e.code, location: e.location, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, repeat: e.repeat, bubbles: true, cancelable: true }); }
        catch (err) { return; }
        window.dispatchEvent(ev);
        if (ev.defaultPrevented) { e.preventDefault(); e.stopPropagation(); }
      }, true);
      // the end of a held chord reaches the OS too: releasing ⌥ closes the app switcher (⌥Tab) and switches
      w.addEventListener("keyup", function (e) {
        if (!/^(Alt|Control|Meta|Shift|AltGraph)$/.test(e.key)) return;
        try { window.dispatchEvent(new KeyboardEvent("keyup", { key: e.key, code: e.code, location: e.location, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, bubbles: true, cancelable: true })); } catch (err) {}
      }, true);
    }
    try { w.document.documentElement.classList.toggle("os-aside", !!aside); } catch (e) {}
    pushInsets();
    pushStill();
    flush();
  }
  // rdg perf: the desk holds still when Breathing is off, motion is reduced, or another app is in front
  // (Atlas's own big icon views hold still for the same reason: hundreds of breathing covers halve the frame rate)
  function pushStill() {
    var still = false;
    try {
      var front = A.apps.active();
      still = !A.prefs.get("com.atlas.desktop", "breathing", true) || !!A.reduced || !!(front && app && front !== app);
    } catch (e) {}
    var b = board(); if (b && b.setStill) b.setStill(still);
  }

  /* ---------- in front, hidden, shown ---------- */
  var app = null;
  function closeFloating() {
    try { if (A.ui && A.ui.menuOpen && A.ui.menuOpen()) A.ui.closeMenus(); } catch (e) {}
    try { if (A.spotlight && A.spotlight.isOpen && A.spotlight.isOpen()) A.spotlight.close(); } catch (e) {}
    try { if (A.center) { if (A.center.isOpen && A.center.isOpen()) A.center.close(); else if (A.center.controlOpen && A.center.controlOpen()) A.center.closeControl(); } } catch (e) {}
  }
  function activate() {
    closeFloating();
    if (app && A.apps.active() !== app) A.apps.setActive(app);
  }
  function focusFrame() {
    if (!frame || hidden) return;
    try { frame.focus({ preventScroll: true }); } catch (e) { try { frame.focus(); } catch (e2) {} }
    try { frame.contentWindow.focus(); } catch (e) {}
  }
  function hideShelf() {
    if (!frame || hidden) return;
    hidden = true; frame.hidden = true;
    if (app) app.hidden = true;
    if (document.activeElement === frame) { try { frame.blur(); } catch (e) {} }
    // the app in front becomes the key window's, else Finder (what Atlas does for any app it hides)
    if (app && A.apps.active() === app) { var f = A.wm.focused(); A.apps.setActive(f && !f.closing ? f.app : (A.apps.get("finder") || null)); }
    A.bus.emit("app:hidden", app); A.bus.emit("app:changed", app);
  }
  function unhideShelf() {
    if (!frame) make();
    if (!frame || !hidden) return;
    hidden = false; frame.hidden = false;
    if (app) app.hidden = false;
    pushInsets();   // the board was not laid out while hidden: fit it again
    A.bus.emit("app:unhidden", app); A.bus.emit("app:changed", app);
  }
  // ⌥H, Hide others and Show all reach the Shelf too: it has no windows for the window manager to hide
  var wmHide = A.wm.hideApp, wmUnhide = A.wm.unhideApp;
  A.wm.hideApp = function (a) { if (a && a.id === "shelf") return hideShelf(); return wmHide.apply(this, arguments); };
  A.wm.unhideApp = function (a) { if (a && a.id === "shelf") return unhideShelf(); return wmUnhide.apply(this, arguments); };
  function show(o) {
    o = o || {};
    make(); unhideShelf();
    if (o.focus !== false) focusFrame();
  }

  /* ---------- notes, fields and the catalog ---------- */
  function cat() { return (RDG && RDG.catalog && RDG.catalog()) || { notes: [], chapters: [] }; }
  function fields() { return (cat().chapters || []).filter(function (c) { return /^[A-F] · /.test(c.title || ""); }); }
  function moc() { return (cat().notes || []).filter(function (n) { return /^00_MOC/.test(String(n.path || "").split("/").pop()); })[0] || null; }
  function openNote(id) {
    if (R.openNote) { R.openNote(id); return; }
    var n = RDG && RDG.notesIndex ? RDG.notesIndex()[id] : null; if (n && n.href) location.href = n.href;
  }
  function boardState() {
    var b = board(), s = b && b.state ? b.state() : null;
    if (s) return s;
    var ls = RDG ? RDG.ls : null;
    return { links: !!(ls && ls.get("rdg-wires", false)), papers: !!(ls && ls.get("rdg-papers", false)), hasPapers: false, tray: null, detail: null };
  }
  function changed() { if (app) A.bus.emit("app:changed", app); }

  /* ---------- the app ---------- */
  var TRAYS = [["todo", "To read"], ["reading", "Reading"], ["done", "Done"]];
  function menus() {
    var s = boardState();
    var view = [
      { label: "Fit all", cmd: "shelf fit", run: function () { R.showShelf(); withBoard(function (b) { b.fit(); }); } },
      { label: "Links", checked: !!s.links, cmd: "shelf links " + (s.links ? "off" : "on"), run: function () { withBoard(function (b) { b.toggle("links"); changed(); }); } }
    ];
    if (s.hasPapers) view.push({ label: "Papers", checked: !!s.papers, cmd: "shelf papers " + (s.papers ? "off" : "on"), run: function () { withBoard(function (b) { b.toggle("papers"); changed(); }); } });
    view.push("-", { header: "Reading status" });
    TRAYS.forEach(function (t) { view.push({ label: t[1], checked: s.tray === t[0], cmd: "shelf tray " + (s.tray === t[0] ? "off" : t[0]), run: function () { R.filterTray(s.tray === t[0] ? null : t[0]); } }); });
    var go = [
      { label: "Today", cmd: "today", run: function () { if (R.openToday) R.openToday(); } },
      { label: "Overview map", disabled: !moc(), run: function () { var m = moc(); if (m) openNote(m.id); } }
    ];
    var fs = fields();
    if (fs.length) { go.push("-", { header: "Fields" }); fs.forEach(function (c) { go.push({ label: c.title, cmd: "shelf field " + c.n, run: function () { R.showField(c.n); } }); }); }
    return [{ title: "View", items: view }, { title: "Go", items: go }];
  }
  app = A.apps.register({
    id: "shelf", name: "Shelf", icon: "shelf", accent: "#626c55", order: 1, cli: "shelf", noQuit: true, aliases: ["board"],
    desc: "Every note on one board, grouped by field. Drag a note onto a tray to mark it To read, Reading or Done.",
    launch: function (a, args) { show(args); },
    reopen: function (a, args) { show(args); },
    menus: menus
  });

  /* ---------- what other parts call ---------- */
  // a note or field shown on the board would sit under the open windows: they move aside (Atlas Show Desktop),
  // and come back when any window is focused again
  var aside = false;
  A.bus.on("desktop", function (v) {
    aside = !!v;
    // the board's right-hand parts step clear of the windows' edges while they are aside
    try { var d = frame && frame.contentDocument; if (d && d.documentElement) d.documentElement.classList.toggle("os-aside", aside); } catch (e) {}
  });
  function clearView() { try { if (!aside && A.wm.visible().length) A.wm.showDesktop(); } catch (e) {} }
  // Shelf in front; with an id, that note's details open on the board (index.html#n=<id>, Find on Shelf)
  R.showShelf = function (id) {
    A.apps.launch("shelf");
    if (id) { clearView(); withBoard(function (b) { b.openDetail(id); }); }
  };
  // the To read, Reading or Done tray (anything else clears the filter)
  R.filterTray = function (s) {
    A.apps.launch("shelf");
    withBoard(function (b) { b.filterTray(s === "todo" || s === "reading" || s === "done" ? s : null); changed(); });
  };
  // fit the board to one field (a chapter number of the catalog)
  R.showField = function (ch) {
    A.apps.launch("shelf");
    clearView();
    withBoard(function (b) { if (b.focusField) b.focusField(ch); });
  };
  R.focusShelf = function () { if (!hidden) { activate(); focusFrame(); } };
  R.shelfFrame = function () { return frame; };

  /* ---------- the shell command, so menus can show what they run (⌥) and Terminal can do it too ---------- */
  if (A.prog) A.prog("shelf", "Reading", "show the Shelf, the board of every note", "shelf [show | hide | fit | note ID | tray todo|reading|done|off | field N | links on|off | papers on|off]", async function (p) {
    var a = p.args, sub = a[0] || "show", onoff = function (v) { if (v !== "on" && v !== "off") throw A.usageErr("say on or off"); return v === "on"; };
    switch (sub) {
      case "show": R.showShelf(); return 0;
      case "hide": A.wm.hideApp(app); return 0;
      case "fit": R.showShelf(); withBoard(function (b) { b.fit(); }); return 0;
      case "note": { var id = a[1]; if (!id || !(RDG.notesIndex()[id])) throw A.usageErr("no note with id " + (id || "")); R.showShelf(id); return 0; }
      case "tray": { var s = a[1]; if (["todo", "reading", "done", "off"].indexOf(s) < 0) throw A.usageErr("tray is todo, reading, done or off"); R.filterTray(s === "off" ? null : s); return 0; }
      case "field": { var n = +a[1]; if (!(cat().chapters || []).some(function (c) { return c.n === n; })) throw A.usageErr("no field " + (a[1] || "")); R.showField(n); return 0; }
      case "links": { var on = onoff(a[1]); withBoard(function (b) { b.toggle("links", on); changed(); }); return 0; }
      case "papers": { var on2 = onoff(a[1]); withBoard(function (b) { b.toggle("papers", on2); changed(); }); return 0; }
      default: throw A.usageErr("unknown shelf command '" + sub + "'");
    }
  });

  /* ---------- life ---------- */
  // the board loads while the boot screen plays; at login Shelf is running (Dock dot), and the restored windows,
  // when there are any, take the front from it as they open
  if (document.getElementById("desktop")) make(); else document.addEventListener("DOMContentLoaded", make);
  A.bus.on("desktop:ready", function () {
    // the keyboard is not taken here: a deep link (#k, #today, #r=) or Today may want it; rdg-system gives it to
    // the Shelf afterwards when nothing else took it
    if (!app.running) { try { var f = A.wm.focused(); A.apps.launch(app, { focus: false }); if (f && !f.closing) f.focus(); } catch (e) { console.error(e); } }
  });
  // the Dock's size or autohide changed, or the screen did: the board's floating parts move with it
  A.bus.on("prefs:com.atlas.dock", pushInsets);
  A.bus.on("app:active", pushStill);
  A.bus.on("prefs:com.atlas.desktop", pushStill);
  var rzT = 0; window.addEventListener("resize", function () { clearTimeout(rzT); rzT = setTimeout(pushInsets, 120); });
  // the board changed Links, Papers or a status itself: the menu's ticks follow
  window.addEventListener("storage", function (e) { if (e.key === "rdg-wires" || e.key === "rdg-papers" || e.key === "rdg-progress") { if (A.apps.active() === app) changed(); } });
})(window.ATLAS);
