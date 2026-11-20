/* Reading OS vendored file atlas-main.js
   Source: Atlas OS 0.2.2, "Atlas OS.html" lines 25789-25919 (sha256 0c9f4b58319f7303...).
   Patches: P2, P7, P8, P9, P10, P11, P16 (each marked rdg: Pn). Do not edit by hand; regenerate with .scripts/os/vendor.py. */
/* ==========================================================================
   Atlas OS · main
   Boot order: kernel and disk → /bin and /Applications → init and daemons →
   window manager and shell → boot screen → login → the saved session.
   ========================================================================== */
(function (A) {
  "use strict";
  var K = A.K, FS = K.fs, HOME = K.home;
  var $ = function (s) { return document.querySelector(s); };

  /* ---------- session: which windows were open, where, showing what ---------- */
  var SKEY = "rdg-os-session"; /* rdg: P7 */
  A.session = {
    save: function (force) {
      if ((A.shell.poweringDown || A.shell.loggedOut) && !force) return;
      // windows only: a panel (Quick Look) is not in A.wm.list(), and never comes back with the session
      var list = A.wm.list().filter(function (w) { return w.app && w.app.def.saveState && !w.closing && !w.panel; }).sort(function (a, b) { return (a.lastFocus || 0) - (b.lastFocus || 0); });
      var out = list.map(function (w) { var st = null; try { st = w.app.def.saveState(w); } catch (e) {} return st === null ? null : { app: w.app.id, f: w.frame(), pf: w.saved || null, z: w.el.classList.contains("zoomed"), min: w.minimized, st: st }; }).filter(Boolean);
      try { localStorage.setItem(SKEY, JSON.stringify({ wins: out, at: Date.now() })); } catch (e) {}
    },
    restore: function () {
      var s = null; try { s = JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) {}
      if (!s || !s.wins || !s.wins.length) return false;
      var n = 0;
      s.wins.forEach(function (it, i) {
        var app = A.apps.get(it.app); if (!app || !app.def.restore) return;
        setTimeout(function () {
          try {
            var n0 = app.windowsList().length;
            app.running = true; app.def.restore(app, it.st, it.f); n++;
            // only a window this restore added takes the saved zoom/minimise state (TextEdit's restore can add none)
            var w = app.windowsList().length > n0 ? app.windowsList()[app.windowsList().length - 1] : null;
            // re-adopt how the frame was kept (shown vs chosen, wm.js) when the app restored exactly that frame;
            // Calculator and Preview compute their own sizes and are left alone
            var k = w && it.f && w.frame();
            if (k && typeof it.f.inX === "boolean" && k.x === it.f.x && k.y === it.f.y && k.w === it.f.w && k.h === it.f.h) w.setFrame(it.f);
            if (w && it.pf) { w.saved = it.pf; if (it.z) w.el.classList.add("zoomed"); }
            if (w && it.min) w.minimize();
            A.bus.emit("app:changed", app);
          } catch (e) { console.error(e); }
        }, i * 70);
      });
      return true;
    }
  };
  var saveT = 0;
  ["win:open", "win:close", "win:moved", "win:minimize", "win:restore", "win:focus", "win:resize"].forEach(function (ev) { A.bus.on(ev, function () { clearTimeout(saveT); saveT = setTimeout(A.session.save, 400); }); });
  K.on("cwd", function () { clearTimeout(saveT); saveT = setTimeout(A.session.save, 400); });

  /* ---------- /Applications: one folder per app, so ls, Finder and open -a all agree ---------- */
  function installApplications() {
    try { FS.mkdir("/Applications", true); } catch (e) {}
    A.apps.all().forEach(function (a) {
      if (a.def.hidden) return;
      var dir = "/Applications/" + a.name + ".app";
      try { if (!FS.isDir(dir)) FS.mkdir(dir, true); var info = JSON.stringify({ id: a.id, name: a.name, cli: a.def.cli || null, version: K.version }, null, 1) + "\n"; var cur = ""; try { cur = FS.read(dir + "/Info.json"); } catch (e) {} if (cur !== info) FS.write(dir + "/Info.json", info); } catch (e) {}
    });
  }

  /* The first desk: the Terminal in front with the keyboard, Finder's window behind it, and the corner the desktop
     seeds its sunflower from left free (DESIGN.md §3.3; ui/shell.js seedSpots), so the first cover there, Welcome.md
     on a new disk, shows whole with its name. That cover's box ends 106 px from the right edge and 145 px under
     the menu bar; both windows keep one step of the paper's grid (24 px) from it. */
  function firstRun() {
    if (A.reading && A.reading.firstRun) return A.reading.firstRun(); /* rdg: P9 */
    var wa = A.wm.workArea(), edge = window.innerWidth - 130, below = wa.y + 169;
    var t = A.terminal.open({});
    // on a screen too narrow for the Terminal beside that cover, it opens to the left of it, narrower if it must
    if (t && !A.wm.narrow() && t.y < below && t.x + t.w > edge) { var tw = Math.min(t.w, edge - 8); t.setFrame({ x: edge - tw, y: t.y, w: tw, h: t.h }); }
    setTimeout(function () { if (A.apps.get("finder")) A.apps.launch("finder", { dir: HOME, newWindow: true, x: Math.max(20, edge - 560), y: 70, w: 560, h: 380, focus: false }); if (t) t.focus(); }, 500);
  }
  function start() {
    var restored = A.session.restore();
    if (!restored) firstRun();
    A.desktop.ready = true;
    A.bus.emit("desktop:ready");
  }

  function boot() {
    var image = {}; try { image = JSON.parse($("#fsimage").textContent); } catch (e) { K.log("boot: the factory image is unreadable", "warn"); }
    K.log("Atlas kernel " + K.version + "-" + K.codename + " (" + K.engine() + ")");
    K.log("display: " + window.innerWidth + "×" + window.innerHeight + " at " + (window.devicePixelRatio || 1) + "x, warm paper #ecebe6");
    K.log("cpu: " + K.cpus() + " logical · memory " + ((navigator.deviceMemory && navigator.deviceMemory + " GB") || "unreported"));
    K.mountRoot(image);
    if (A.reading) A.reading.mount(); /* rdg: P10 */
    K.installBin();
    ["Desktop", "Documents", "Downloads", "Pictures", "Library/Preferences"] /* rdg: P16 */.forEach(function (d) { try { FS.mkdir(HOME + "/" + d, true); } catch (e) {} });
    try { var hn = FS.read("/etc/hostname").trim(); if (hn) K.hostname = hn; } catch (e) {}
    K.startInit();
    installApplications();
    var nApps = A.apps.all().length; K.log("windowd: " + nApps + (nApps === 1 ? " application" : " applications") + " registered");
    A.wm.init($("#windows"));
    A.shell.build();
    // Breathing and Reduce Motion (Control Center, System Settings, defaults write desktop …) apply at once
    var motion = function () {
      A.reducedPref = !!A.prefs.get("com.atlas.desktop", "reduceMotion", false);
      $("#os").classList.toggle("reduce", A.reducedPref);
      $("#os").classList.toggle("still", !A.prefs.get("com.atlas.desktop", "breathing", true) || A.reduced);
    };
    motion(); A.bus.on("prefs:com.atlas.desktop", motion);
    // syncd could not write the disk image. Either the image has outgrown the browser's storage, and removing files
    // helps; or the browser keeps nothing for this page (a private window, blocked site data), the image is far
    // from full, as every gauge says, and nothing the person removes will help: their files last as long as the tab
    var unsaved = "";
    K.on("syncfail", function () {
      var used = 0; try { used = Math.max(K.store.size() || 0, JSON.stringify(FS.snapshot()).length * 2); } catch (e) {}
      if (used >= FS.quota * 0.9) { unsaved = "The disk image is full: your last changes were not saved."; A.notify("Disk image is full", "Remove large files with rm or empty the Trash. Reading data takes room too: Control Center lists it under Reading data."); /* rdg: P2 */ }
      else { unsaved = "Your files were not saved: this browser is not keeping Atlas's disk."; A.notify("Disk image is not saved", "This browser is not keeping Atlas's disk. Your files last until this tab closes.", { state: "todo" }); }
    });
    // the Off screen says the files are saved only when the last write of the image went through
    K.on("shutdown", function () { var p = $("#power p"); if (p && unsaved && FS.dirty()) p.textContent = unsaved; });
    window.addEventListener("pagehide", function () { FS.sync(); A.session.save(); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) { FS.sync(); A.session.save(); } });
    $("#powerOn").onclick = function () { location.reload(); };
    /* rdg: P8 Reading OS has no assistant: nothing asks for one */
    // after a log out, the next login reopens the windows that were open
    A.bus.on("unlock", function (d) { if (d && d.afterLogout && A.desktop.ready && !A.session.restore()) firstRun(); });
    if (A.reading) A.reading.ready(); /* rdg: P11 */
    A.shell.boot(function () {
      if (A.prefs.get("com.atlas.user", "autologin", false)) { start(); return; }
      A.shell.lock();
      var off = A.bus.on("unlock", function () { off(); start(); });
    });
  }
  boot();
})(window.ATLAS = window.ATLAS || {});
