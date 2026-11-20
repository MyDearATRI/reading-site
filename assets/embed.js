/* Reading · embed layer (built as assets/embed.js, loaded with defer on every page)

   Two modes, decided once when the page loads:

   Standalone (the page is the whole tab)
     - Cmd-K (Ctrl-K off Apple) goes to the Reading OS search: index.html#k.
     - Note pages (body[data-note]) get one more header link, "Open in Reading OS" (index.html#r=<id>).
     Nothing else changes.

   Embedded (inside a Reader window: window.top !== window and top.ATLAS.reading exists, same origin)
     - header.bar and footer.site are hidden; the window title bar replaces them.
     - A link to another page of the site navigates inside the frame through the Reader
       (frameElement.rdgReader.go), so the window's own Back and Forward know about it.
     - Links to the OS index or shelf.html (#n=<id>, #r=<id>, #k, #today) are handled by the OS
       instead of loading a second OS inside the frame.
     - zotero: links are opened by the top window (iframes may not hand external protocols to the system).
     - Links to other sites open in a new tab (target=_blank rel=noopener).
     - Cmd-K opens the OS Spotlight.

   window.RDGEmbed = { embedded, root } tells the Reader this page already has the layer.
   No storage, no network. */
(function () {
  "use strict";

  if (window.RDGEmbed) return; // loaded twice (the Reader adds it to a page built without it)

  var IS_APPLE = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

  // ---- where the site root is: this file lives at <root>assets/embed.js
  var root = (function () {
    var me = document.currentScript;
    if (me && me.src) {
      try { return new URL("../", me.src).href; } catch (e) { /* fall through */ }
    }
    var brand = document.querySelector("header.bar a.brand");
    if (brand) {
      try { return new URL(".", brand.href).href; } catch (e) { /* fall through */ }
    }
    return new URL(".", location.href).href;
  })();
  var rootPath = new URL(root).pathname;
  var OS_INDEX = root + "index.html";

  // ---- the Reading OS around this page, if any
  function host() {
    try {
      var t = window.top;
      if (t && t !== window && t.ATLAS && t.ATLAS.reading) return t.ATLAS;
    } catch (e) { /* another origin: not ours */ }
    return null;
  }
  var embedded = !!host();

  window.RDGEmbed = { embedded: embedded, root: root };

  function frameEl() {
    try { return window.frameElement; } catch (e) { return null; }
  }

  function addStyle(text) {
    var s = document.createElement("style");
    s.setAttribute("data-rdg-ui", "embed");
    s.textContent = text;
    (document.head || document.documentElement).appendChild(s);
  }

  function isCmdK(e) {
    if (!(IS_APPLE ? e.metaKey : e.ctrlKey) || e.altKey) return false;
    return e.code === "KeyK" || (!!e.key && e.key.toLowerCase() === "k");
  }

  function openSpotlight() {
    var A = host();
    if (!A) return;
    try {
      if (A.spotlight && A.spotlight.open) A.spotlight.open("");
      else if (A.spotlight && A.spotlight.toggle) A.spotlight.toggle();
    } catch (e) { /* the OS is shutting down or locked */ }
  }

  // ---- links that belong to the OS itself: index.html#… and shelf.html#…
  function hashParam(hash, key) {
    var m = new RegExp("^#" + key + "=(.+)$").exec(hash || "");
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  function osRoute(u) {
    if (u.origin !== location.origin) return null;
    var p = u.pathname;
    var isIndex = p === rootPath || p === rootPath + "index.html";
    var isShelf = p === rootPath + "shelf.html";
    if (!isIndex && !isShelf) return null;
    var A = host();
    var R = A && A.reading;
    if (!R) return null;
    var hash = u.hash;
    return function () {
      var n = hashParam(hash, "n");
      var r = hashParam(hash, "r");
      if (r && isIndex && typeof R.openNote === "function") { R.openNote(r); return; }
      if (hash === "#k" && isIndex) { openSpotlight(); return; }
      if (hash === "#today" && typeof R.openToday === "function") { R.openToday(); return; }
      if (typeof R.showShelf === "function") { R.showShelf(n || undefined); return; }
      try {
        if (A.apps && A.apps.get("shelf")) { A.apps.launch("shelf"); return; }
      } catch (e) { /* fall through */ }
      try { window.top.location.href = u.href; } catch (e) { location.href = u.href; }
    };
  }

  function samePage(u) {
    return u.origin === location.origin && u.pathname === location.pathname && u.search === location.search;
  }

  function markExternal(a) {
    a.setAttribute("target", "_blank");
    var rel = (a.getAttribute("rel") || "").split(/\s+/).filter(Boolean);
    if (rel.indexOf("noopener") < 0) rel.push("noopener");
    a.setAttribute("rel", rel.join(" "));
  }

  // ---------- standalone ----------
  if (!embedded) {
    window.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || !isCmdK(e)) return;
      e.preventDefault();
      location.href = OS_INDEX + "#k";
    }, true);

    var noteId = document.body && document.body.getAttribute("data-note");
    var bar = document.querySelector("header.bar");
    if (noteId && bar && !bar.querySelector("a.rdg-os")) {
      addStyle(".bar a.rdg-os { padding-left: 16px; color: var(--ink); }");
      var link = document.createElement("a");
      link.className = "rdg-os";
      link.href = OS_INDEX + "#r=" + encodeURIComponent(noteId);
      link.textContent = "Open in Reading OS";
      if (!bar.querySelector(".find")) link.style.marginLeft = "auto";
      bar.appendChild(link);
    }
    return;
  }

  // ---------- embedded in a Reader window ----------
  document.documentElement.classList.add("rdg-embedded");
  addStyle(
    "html.rdg-embedded header.bar, html.rdg-embedded footer.site { display: none !important; }\n" +
    // the Reader window toolbar already has the G1–G4 control (through RDGDepth); keep one control, not two
    "html.rdg-embedded article > .depth { display: none !important; }\n" +
    "html.rdg-embedded body.doc main { padding-top: 36px; }\n" +
    "html.rdg-embedded body.desk main { padding-top: 24px; }"
  );

  // links to other sites: a new tab, never this frame
  Array.prototype.forEach.call(document.querySelectorAll("a[href]"), function (a) {
    var u;
    try { u = new URL(a.href, location.href); } catch (e) { return; }
    if ((u.protocol === "http:" || u.protocol === "https:") && u.origin !== location.origin) markExternal(a);
  });

  // Cmd-K: the OS Spotlight. Registered on window in the capture phase, so it runs before any
  // page listener; stopImmediatePropagation keeps a second handler (an older inline Cmd-K script,
  // or a key relay added later by the OS) from acting on the same key.
  window.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || !isCmdK(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openSpotlight();
  }, true);

  // Bubble phase: depth.js and desk.js act first and may prevent the default.
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var raw = a.getAttribute("href") || "";

    if (/^\s*zotero:/i.test(raw)) {
      e.preventDefault();
      try { window.top.location.href = a.href; } catch (err) { location.href = a.href; }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // the browser's own new-tab gestures

    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (u.origin !== location.origin) { markExternal(a); return; }

    var route = osRoute(u);
    if (route) { e.preventDefault(); route(); return; }

    var tgt = a.getAttribute("target");
    if (tgt && tgt.toLowerCase() !== "_self") return;
    if (samePage(u)) return; // an in-page fragment: the browser scrolls, depth.js reveals

    var fe = frameEl();
    if (fe && fe.rdgReader && typeof fe.rdgReader.go === "function") {
      e.preventDefault();
      fe.rdgReader.go(u.href);
    }
    // otherwise the frame navigates by itself and the Reader picks the page up on load
  });
})();
