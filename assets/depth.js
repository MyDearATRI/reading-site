/* Reading · depth control (G1–G4)
   Atlas OS PRD 6.4 (time budgets) and 6.5 (wide vs deep reading), pain P13.
   On note pages whose h2 headings carry G levels, a quiet segmented control after the h1
   lets the reader stop at G1, G2, G3 or G4. Hiding uses the hidden attribute only:
   the note's text and block order are never changed (K3).

   Matched headings (checked against the built site):
     field notes   "G1｜3 分鐘速覽", "G2｜15 分鐘：…", "G3｜…", "G4｜…"   (｜ or |, spaces may vary)
     daily reports "第一層（G1）｜5 分鐘看完…", "第二層（G2）｜…"
   A G section runs from its h2 to the next G h2 (or the end of the article), so the
   "星系 A｜…" h2s that hold a daily report's G2 cards stay inside G2.
   Content before the first G heading is never hidden.
   Time labels come only from the heading text ("3 分鐘" -> "3 min"); no number is invented (K4).

   Storage: localStorage "rdg-depth" = "G1" | "G2" | "G3" | "G4" | "All" (plain text, global).
   Only explicit clicks write it. Opening a link into a hidden section shows all for this view only.

   window.RDGDepth (used by the Reading OS Reader window):
     levels()   the G levels this page has, e.g. ["G1", "G2", "G4"]; [] when the page has fewer than two
     get()      what the control shows now: "G1".."G4" or "All"
     set(v, o)  apply "G1".."G4" or "All" as a click would (saved to rdg-depth unless o.persist === false);
                returns get(), or null when v is not a level or the page has no control */
(function () {
  "use strict";

  var KEY = "rdg-depth";
  var HEAD = /^\s*(?:第\S{1,3}層\s*[（(]\s*)?G\s*([1-4])\s*[）)]?\s*[｜|]/;
  var MINUTES = /[｜|]\s*(\d{1,3})\s*分鐘/;
  var UI = "data-rdg-ui";
  var MARK = "data-depth-hidden";

  // a page without a control still answers, so a caller never has to test for it
  window.RDGDepth = {
    levels: function () { return []; },
    get: function () { return "All"; },
    set: function () { return null; }
  };

  var article = document.querySelector("body.doc main article") || document.querySelector("main article");
  if (!article) return;

  function isUi(el) { return el.hasAttribute && el.hasAttribute(UI); }

  // ---- find the G headings (direct children of the article)
  var levels = [];
  var info = {};
  Array.prototype.forEach.call(article.children, function (el) {
    var lv = headLevel(el);
    if (!lv || info[lv]) return;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    var m = MINUTES.exec(text);
    info[lv] = { title: text, minutes: m ? m[1] : "" };
    levels.push(lv);
  });
  levels.sort(function (a, b) { return a - b; });
  if (levels.length < 2) return; // one level alone has nothing to choose between

  function headLevel(el) {
    if (!el || el.tagName !== "H2" || isUi(el)) return 0;
    var m = HEAD.exec(el.textContent || "");
    return m ? +m[1] : 0;
  }

  // ---- storage (every access guarded)
  function valid(v) { return v === "All" || /^G[1-4]$/.test(v || "") ? v : null; }
  function load() {
    try { return valid(window.localStorage.getItem(KEY)) || "All"; } catch (e) { return "All"; }
  }
  function save(v) {
    try { window.localStorage.setItem(KEY, v); } catch (e) { /* private window or blocked storage */ }
  }

  var reduceMq = null;
  try { reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (e) { reduceMq = null; }
  function reduced() { return !!(reduceMq && reduceMq.matches); }

  // ---- build the control
  var wrap = document.createElement("div");
  wrap.className = "depth";
  wrap.setAttribute(UI, "depth");

  var group = document.createElement("div");
  group.className = "depth-seg";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Reading depth");

  var buttons = [];
  levels.forEach(function (lv) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("data-depth", "G" + lv);
    b.setAttribute("aria-pressed", "false");
    b.title = info[lv].title;
    b.appendChild(document.createTextNode("G" + lv));
    if (info[lv].minutes) {
      b.appendChild(document.createTextNode(" "));
      var dot = document.createElement("span");
      dot.className = "depth-t";
      dot.setAttribute("aria-hidden", "true");
      dot.textContent = "·";
      b.appendChild(dot);
      b.appendChild(document.createTextNode(" "));
      var t = document.createElement("span");
      t.className = "depth-t";
      t.textContent = info[lv].minutes + " min";
      b.appendChild(t);
    }
    buttons.push(b);
    group.appendChild(b);
  });
  var allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.setAttribute("data-depth", "All");
  allBtn.setAttribute("aria-pressed", "false");
  allBtn.textContent = "All";
  buttons.push(allBtn);
  group.appendChild(allBtn);

  var status = document.createElement("span");
  status.className = "depth-sr";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  wrap.appendChild(group);
  wrap.appendChild(status);

  var h1 = null;
  for (var i = 0; i < article.children.length; i++) {
    if (article.children[i].tagName === "H1") { h1 = article.children[i]; break; }
  }
  if (!h1) h1 = article.querySelector("h1");
  if (h1 && h1.parentNode) h1.parentNode.insertBefore(wrap, h1.nextSibling);
  else article.insertBefore(wrap, article.firstChild);

  var rest = document.createElement("div");
  rest.className = "depth-rest";
  rest.setAttribute(UI, "depth");
  rest.hidden = true;
  var restText = document.createElement("span");
  restText.className = "depth-rest-t";
  var restBtn = document.createElement("button");
  restBtn.type = "button";
  restBtn.textContent = "Show all";
  rest.appendChild(restText);
  rest.appendChild(restBtn);
  article.appendChild(rest);

  // ---- sections, computed fresh each time (other scripts may add nodes later)
  function sections() {
    var out = [];
    var current = 0;
    Array.prototype.forEach.call(article.children, function (el) {
      if (isUi(el)) return;
      var lv = headLevel(el);
      if (lv) current = lv;
      out.push({ el: el, level: current });
    });
    return out;
  }

  // ---- Mermaid renders inside its own element and measures text; inside display:none it
  // lays out at zero size. While a diagram in a section we hide is still rendering, that block
  // is parked off-screen with visibility:hidden (still measurable) and gets the hidden attribute
  // once its SVG is in, or after 10 s.
  var holdObs = null;
  var holdTimer = 0;

  function pendingDiagram(el) {
    var list = [];
    if (el.matches && el.matches(".mermaid")) list.push(el);
    if (el.querySelectorAll) Array.prototype.push.apply(list, el.querySelectorAll(".mermaid"));
    for (var j = 0; j < list.length; j++) {
      if (!diagramDone(list[j])) return true;
    }
    return false;
  }

  // Mermaid first inserts a placeholder div > svg, draws into it, then replaces the element's
  // content with the final svg. Only a direct-child svg means the drawing is finished.
  function diagramDone(m) {
    for (var c = m.firstElementChild; c; c = c.nextElementSibling) {
      if (c.tagName.toLowerCase() === "svg") return true;
    }
    return false;
  }

  function park(el) {
    el.classList.remove("depth-hold");
    el.style.removeProperty("width");
    el.hidden = true;
    el.setAttribute(MARK, "1");
  }

  function settleHolds(force) {
    var held = article.querySelectorAll("[" + MARK + '="hold"]');
    var left = 0;
    Array.prototype.forEach.call(held, function (el) {
      if (force || !pendingDiagram(el)) park(el);
      else left++;
    });
    if (!left) stopHolds();
  }

  function stopHolds() {
    if (holdObs) { holdObs.disconnect(); holdObs = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  }

  function watchHolds() {
    if (holdObs || holdTimer) return;
    if (window.MutationObserver) {
      holdObs = new MutationObserver(function () { settleHolds(false); });
      holdObs.observe(article, { childList: true, subtree: true });
    }
    holdTimer = setTimeout(function () { holdTimer = 0; settleHolds(true); }, 10000);
  }

  function hide(el) {
    if (el.hasAttribute(MARK)) return; // already hidden or parked by us
    if (el.hidden) return;             // hidden by someone else: leave it alone
    if (pendingDiagram(el)) {
      el.setAttribute(MARK, "hold");
      el.style.width = article.clientWidth + "px";
      el.classList.add("depth-hold");
      watchHolds();
    } else {
      park(el);
    }
  }

  function show(el) {
    if (!el.hasAttribute(MARK)) return;
    el.removeAttribute(MARK);
    el.classList.remove("depth-hold");
    el.style.removeProperty("width");
    el.hidden = false;
  }

  // ---- apply a choice
  var current = "All";
  var pressedNow = "All";

  function effective(choice) {
    if (choice === "All") return Infinity;
    var k = +choice.slice(1);
    var eff = levels[0];
    levels.forEach(function (lv) { if (lv <= k) eff = lv; });
    return eff;
  }

  function hiddenWords(hiddenLevels) {
    var names = hiddenLevels.map(function (lv) { return "G" + lv; });
    if (names.length === 1) return names[0] + " hidden";
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1] + " hidden";
  }

  function apply(choice, opts) {
    opts = opts || {};
    choice = valid(choice) || "All";
    current = choice;
    var eff = effective(choice);

    sections().forEach(function (s) {
      if (s.level && s.level > eff) hide(s.el);
      else show(s.el);
    });
    if (!article.querySelector("[" + MARK + '="hold"]')) stopHolds();

    var pressed = choice === "All" ? "All" : "G" + eff;
    pressedNow = pressed;
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-depth") === pressed));
    });

    var hiddenLevels = levels.filter(function (lv) { return lv > eff; });
    if (hiddenLevels.length) {
      restText.textContent = hiddenWords(hiddenLevels);
      rest.hidden = false;
    } else {
      rest.hidden = true;
    }
    if (opts.announce) status.textContent = hiddenLevels.length ? hiddenWords(hiddenLevels) : "All levels shown";
    if (opts.persist) save(choice);

    try {
      document.dispatchEvent(new CustomEvent("rdg:depth", { detail: { choice: choice, hidden: hiddenLevels.slice() } }));
    } catch (e) { /* old browser without CustomEvent constructor */ }
  }

  function isHidden(el) {
    return !!(el && el.closest && el.closest("[" + MARK + "]"));
  }

  function byHash(hash) {
    if (!hash || hash.length < 2) return null;
    var raw = hash.slice(1);
    var id = raw;
    try { id = decodeURIComponent(raw); } catch (e) { id = raw; }
    return document.getElementById(id) || document.getElementById(raw) ||
      (document.getElementsByName(id)[0] || null);
  }

  // Show all for this view (not saved), then bring the target into view.
  function reveal(target, scroll) {
    if (!isHidden(target)) return false;
    apply("All", { announce: true });
    if (scroll && target.scrollIntoView) {
      try { target.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" }); }
      catch (e) { target.scrollIntoView(); }
    }
    return true;
  }

  // ---- first paint: saved choice, unless the URL points into a section it would hide
  apply(load());
  var first = byHash(location.hash);
  if (first && isHidden(first)) {
    apply("All");
    // the browser may already have given up on the fragment while it was hidden
    try { first.scrollIntoView({ block: "start" }); } catch (e) { first.scrollIntoView(); }
  }

  // ---- events
  group.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button[data-depth]") : null;
    if (!b || !group.contains(b)) return;
    apply(b.getAttribute("data-depth"), { persist: true, announce: true });
  });

  group.addEventListener("keydown", function (e) {
    var idx = buttons.indexOf(document.activeElement);
    if (idx < 0) return;
    var next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % buttons.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    if (next < 0) return;
    e.preventDefault();
    buttons[next].focus();
  });

  restBtn.addEventListener("click", function () {
    var firstHidden = null;
    sections().some(function (s) {
      if (s.el.hasAttribute(MARK) && headLevel(s.el)) { firstHidden = s.el; return true; }
      return false;
    });
    apply("All", { persist: true, announce: true });
    if (firstHidden) {
      // the button is gone now; keep keyboard focus at the first section that came back
      if (!firstHidden.hasAttribute("tabindex")) {
        firstHidden.setAttribute("tabindex", "-1");
        firstHidden.addEventListener("blur", function drop() {
          firstHidden.removeAttribute("tabindex");
          firstHidden.removeEventListener("blur", drop);
        });
      }
      try { firstHidden.focus({ preventScroll: true }); } catch (e) { firstHidden.focus(); }
    }
  });

  // in-page links into a hidden section: reveal before the browser follows the fragment
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var tgt = a.getAttribute("target");
    if (tgt && tgt.toLowerCase() !== "_self") return;
    var u;
    try { u = new URL(a.getAttribute("href"), location.href); } catch (err) { return; }
    if (!u.hash || u.origin !== location.origin || u.pathname !== location.pathname || u.search !== location.search) return;
    var target = byHash(u.hash);
    if (target && isHidden(target)) {
      reveal(target, false);
      if (u.hash === location.hash) {
        // same fragment: some browsers will not scroll again
        e.preventDefault();
        try { target.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" }); }
        catch (err) { target.scrollIntoView(); }
      }
    }
  }, true);

  window.addEventListener("hashchange", function () {
    var target = byHash(location.hash);
    if (target) reveal(target, true);
  });

  window.RDGDepth = {
    levels: function () { return levels.map(function (lv) { return "G" + lv; }); },
    get: function () { return pressedNow; },
    set: function (v, o) {
      if (!valid(v)) return null;
      apply(v, { persist: !(o && o.persist === false), announce: true });
      return pressedNow;
    }
  };

  // another tab changed the choice
  window.addEventListener("storage", function (e) {
    if (e.key === KEY) apply(valid(e.newValue) || "All");
  });

  // other scripts (for example the highlight layer) can ask for a hidden element to be shown:
  // document.dispatchEvent(new CustomEvent("rdg:reveal", { detail: element }))
  document.addEventListener("rdg:reveal", function (e) {
    var el = e && e.detail;
    if (el && el.nodeType === 1) reveal(el, false);
  });
})();
