/* Reading · reading desk (highlights and margin notes)
   Atlas OS PRD 5.5 (閱讀桌), 6.6 (citation checking), 6.9 (export); kernel K3, K4, K9.

   - Every text block in the article gets a stable paragraph anchor data-p="p1".."pN" in DOM order,
     whether or not depth.js has hidden its section.
   - A highlight wraps only the selected text-node segments in <mark class="ad-mark">. Inline math
     is wrapped whole from outside; nothing inside .katex / .math / svg is touched. The note text
     itself never changes (K3); "Restore original" unwraps the marks again.
   - Storage: localStorage "rdg-desk:<note id>" = JSON array of
     {id, p, quote, prefix, suffix, start, color, note, at}. Unknown fields are kept as they are.
   - On load each mark is found by its exact quote: at the stored offset in its block, then anywhere
     in that block (prefix/suffix decide between repeats), then in any block. Away from its stored
     offset a match counts only when the surrounding text agrees with prefix/suffix, or the quote is
     long and occurs once. A quote that cannot be placed that way is kept and listed as "Original
     text changed" (K4); nothing is dropped. Whitespace runs count as one space, because the browser renders them that way.
   - "Copy as Markdown" hands the user's own marks back as plain text (K9). */
(function () {
  "use strict";

  var body = document.body;
  if (!body) return;
  var noteId = body.getAttribute("data-note");
  if (!noteId) return;
  var article = document.querySelector("main article");
  if (!article) return;

  var KEY = "rdg-desk:" + noteId;
  var UI = "data-rdg-ui";
  var COLORS = ["yellow", "green", "blue", "pink"];
  var COLOR_NAME = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" };
  var BLOCKS = "p, li, h2, h3, h4, h5, h6, td, th, details.callout > summary";
  var NOT_BLOCK = "pre, .mermaid, .math, svg, .katex, [" + UI + "]";
  var CONTEXT = 32;

  function mq(q) {
    try { return window.matchMedia(q); } catch (e) { return null; }
  }
  var reduceMq = mq("(prefers-reduced-motion: reduce)");
  var wideMq = mq("(min-width: 1180px)");
  var coarseMq = mq("(pointer: coarse)");
  function reduced() { return !!(reduceMq && reduceMq.matches); }
  function isWide() { return !!(wideMq && wideMq.matches); }
  function coarse() { return !!(coarseMq && coarseMq.matches); }

  // ---------- paragraph anchors ----------
  var blockList = [];
  (function number() {
    var list = article.querySelectorAll(BLOCKS);
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.closest(NOT_BLOCK)) continue;
      if (el.tagName === "LI" && hasChildP(el)) continue;
      n++;
      el.setAttribute("data-p", "p" + n);
      blockList.push(el);
    }
  })();

  function hasChildP(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.tagName === "P") return true;
    }
    return false;
  }

  function blockById(pid) {
    if (typeof pid !== "string" || !/^p\d+$/.test(pid)) return null;
    return article.querySelector('[data-p="' + pid + '"]');
  }

  // Remember the TeX source of every formula before KaTeX replaces it (runs on DOMContentLoaded,
  // after this deferred script), so the text of a block reads the same before and after rendering.
  Array.prototype.forEach.call(article.querySelectorAll(".math"), function (el) {
    if (!el.hasAttribute("data-desk-tex") && !el.querySelector(".katex")) {
      el.setAttribute("data-desk-tex", el.textContent || "");
    }
  });

  function texToken(el) {
    var tex = el.getAttribute("data-desk-tex");
    if (tex === null) {
      var ann = el.querySelector("annotation");
      tex = ann ? ann.textContent : (el.textContent || "");
    }
    var fence = el.classList.contains("block") ? "$$" : "$";
    return fence + tex + fence;
  }

  // ---------- the text of one block ----------
  // A block's own text: its text nodes, plus one token per formula, minus nested blocks,
  // our own interface, scripts and drawings.
  function segments(block) {
    var segs = [];
    var pos = 0;
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          var len = c.data.length;
          if (len) { segs.push({ node: c, start: pos, end: pos + len, math: false }); pos += len; }
        } else if (c.nodeType === 1) {
          if (c.hasAttribute("data-p") || c.hasAttribute(UI)) continue;
          var tag = c.tagName.toLowerCase();
          if (tag === "script" || tag === "style" || tag === "svg" || tag === "template") continue;
          if (c.classList.contains("math")) {
            var t = texToken(c);
            segs.push({ node: c, start: pos, end: pos + t.length, math: true, token: t });
            pos += t.length;
            continue;
          }
          if (c.classList.contains("katex") || c.classList.contains("mermaid")) continue;
          walk(c);
        }
      }
    })(block);
    return segs;
  }

  function textOf(segs) {
    var out = "";
    for (var i = 0; i < segs.length; i++) out += segs[i].math ? segs[i].token : segs[i].node.data;
    return out;
  }

  var textCache = null; // Map(block -> text) during one restore pass; wrapping keeps the text the same
  function blockText(block) {
    if (textCache && textCache.has(block)) return textCache.get(block);
    var t = textOf(segments(block));
    if (textCache) textCache.set(block, t);
    return t;
  }

  // A boundary point of a range, as an offset in the block's own text.
  function pointToOffset(block, segs, container, offset, isEnd) {
    var r = document.createRange();
    try { r.setStart(block, 0); r.setEnd(container, offset); } catch (e) { return isEnd ? textOf(segs).length : 0; }
    var count = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.math) {
        if (s.node === container || s.node.contains(container)) return isEnd ? s.end : s.start;
      } else if (s.node === container) {
        return s.start + Math.min(offset, s.node.data.length);
      }
      if (r.intersectsNode(s.node)) count = s.end;
      else break;
    }
    return count;
  }

  // ---------- reading the selection ----------
  function ownerOf(textNode) {
    var el = textNode.parentNode;
    if (!el || el.nodeType !== 1) return null;
    if (el.closest("[" + UI + "]")) return "ui";
    var math = el.closest(".math");
    if (math) el = math;
    var owner = el.closest("[data-p]");
    if (!owner || !article.contains(owner)) return null;
    var skip = el.closest("pre, .mermaid, svg, script, style");
    if (skip && owner.contains(skip)) return null;
    return owner;
  }

  // null: nothing to offer; {cross: true}: more than one block; otherwise one block and offsets.
  function readSelection() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var root = range.commonAncestorContainer;
    var nodes = [];
    if (root.nodeType === 3) {
      nodes.push(root);
    } else {
      var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      for (var n = tw.nextNode(); n; n = tw.nextNode()) {
        if (range.intersectsNode(n)) nodes.push(n);
      }
    }
    var owner = undefined;
    var cross = false;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var a = node === range.startContainer ? range.startOffset : 0;
      var b = node === range.endContainer ? range.endOffset : node.data.length;
      if (b <= a || !/\S/.test(node.data.slice(a, b))) continue;
      var o = ownerOf(node);
      if (o === "ui") return null;
      if (owner === undefined) owner = o;
      else if (o !== owner) { cross = true; break; }
    }
    if (owner === undefined) return null;
    var rect = rangeRect(range);
    if (cross) return { cross: true, rect: rect };
    if (!owner) return null;

    var block = owner;
    var segs = segments(block);
    var text = textOf(segs);
    var s = block.contains(range.startContainer) ? pointToOffset(block, segs, range.startContainer, range.startOffset, false) : 0;
    var e = block.contains(range.endContainer) ? pointToOffset(block, segs, range.endContainer, range.endOffset, true) : text.length;
    while (s < e && /\s/.test(text.charAt(s))) s++;
    while (e > s && /\s/.test(text.charAt(e - 1))) e--;
    if (e <= s) return null;
    return { block: block, s: s, e: e, text: text, quote: text.slice(s, e), rect: rect };
  }

  function rangeRect(range) {
    var r = range.getBoundingClientRect();
    if (r && (r.width || r.height)) return r;
    var list = range.getClientRects();
    if (list && list.length) return list[0];
    var c = range.startContainer;
    var el = c.nodeType === 1 ? c : c.parentNode;
    return el.getBoundingClientRect();
  }

  // ---------- storage (every access guarded) ----------
  var saveFailed = false;
  var BACKUP = "rdg-desk-backup:" + noteId + ":";
  var backups = []; // raw texts kept under BACKUP keys for this note

  // Every copy kept for this note, oldest first.
  function readBackups() {
    var out = [];
    try {
      var ls = window.localStorage;
      var keys = [];
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf(BACKUP) === 0 && /^\d+$/.test(k.slice(BACKUP.length))) keys.push(k);
      }
      keys.sort();
      keys.forEach(function (k) {
        var v = ls.getItem(k);
        if (typeof v === "string") out.push(v);
      });
    } catch (e) { /* storage blocked */ }
    return out;
  }

  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { return []; }
    backups = readBackups();
    if (!raw) return [];
    var v = null;
    try { v = JSON.parse(raw); } catch (e) { v = null; }
    if (Array.isArray(v)) return v;
    // Unreadable data is never thrown away: keep one copy under its own key (once per distinct
    // value, so repeat visits do not pile up copies), then start a fresh list. The Marks panel says so.
    if (backups.indexOf(raw) < 0) {
      try { window.localStorage.setItem(BACKUP + Date.now(), raw); } catch (e) { /* storage full: still offered for copying */ }
      backups.push(raw);
    }
    return [];
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(items));
      saveFailed = false;
    } catch (e) {
      saveFailed = true;
    }
    showSaveState();
  }

  function valid(it) {
    return !!(it && typeof it === "object" && typeof it.quote === "string" && /\S/.test(it.quote));
  }

  function colorOf(it) { return COLORS.indexOf(it.color) >= 0 ? it.color : "yellow"; }
  function noteOf(it) { return typeof it.note === "string" ? it.note : ""; }
  function hasNote(it) { return /\S/.test(noteOf(it)); }

  function newId() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  var items = load();
  var rt = {}; // id -> {marks: [], block, orphan}

  function byId(id) {
    for (var i = 0; i < items.length; i++) if (valid(items[i]) && items[i].id === id) return items[i];
    return null;
  }

  // ---------- locating a stored quote ----------
  function collapse(t) { return t.replace(/\s+/g, " "); }

  function normalize(t) {
    var out = "";
    var map = [];
    var ws = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (/\s/.test(ch)) {
        if (!ws) { out += " "; map.push(i); ws = true; }
      } else {
        out += ch; map.push(i); ws = false;
      }
    }
    return { s: out, map: map };
  }

  function commonTail(a, b) {
    var n = 0;
    while (n < a.length && n < b.length && a.charAt(a.length - 1 - n) === b.charAt(b.length - 1 - n)) n++;
    return n;
  }
  function commonHead(a, b) {
    var n = 0;
    while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) n++;
    return n;
  }

  function contextScore(text, s, e, it) {
    var before = collapse(text.slice(Math.max(0, s - CONTEXT * 2), s));
    var after = collapse(text.slice(e, e + CONTEXT * 2));
    var pre = collapse(typeof it.prefix === "string" ? it.prefix : "");
    var suf = collapse(typeof it.suffix === "string" ? it.suffix : "");
    return commonTail(before, pre) + commonHead(after, suf);
  }

  function bestIn(block, text, it, near) {
    var q = it.quote;
    var hits = [];
    var i = text.indexOf(q);
    while (i >= 0) { hits.push([i, i + q.length]); i = text.indexOf(q, i + 1); }
    if (!hits.length) {
      var nq = collapse(q).trim();
      if (!nq) return null;
      var nt = normalize(text);
      var j = nt.s.indexOf(nq);
      while (j >= 0) {
        hits.push([nt.map[j], nt.map[j + nq.length - 1] + 1]);
        j = nt.s.indexOf(nq, j + 1);
      }
    }
    var best = null;
    for (var k = 0; k < hits.length; k++) {
      var sc = contextScore(text, hits[k][0], hits[k][1], it);
      var dist = typeof near === "number" ? Math.abs(hits[k][0] - near) : k;
      if (!best || sc > best.score || (sc === best.score && dist < best.dist)) {
        best = { block: block, s: hits[k][0], e: hits[k][1], score: sc, dist: dist };
      }
    }
    if (best) best.count = hits.length;
    return best;
  }

  // Does the text around a hit agree with the stored context? (K4: a weak match is not an anchor.)
  function agrees(hit, it, text) {
    var pre = collapse(typeof it.prefix === "string" ? it.prefix : "");
    var suf = collapse(typeof it.suffix === "string" ? it.suffix : "");
    if (!pre && !suf) return collapse(text).trim() === collapse(it.quote).trim(); // it was the whole block
    return hit.score >= Math.ceil(Math.min(CONTEXT, pre.length + suf.length) / 2);
  }

  var UNIQUE_MIN = 8; // a quote this long that occurs only once may stand without its context

  // A stored quote's place in the page, or null (shown as "Original text changed").
  function locate(it) {
    var q = it.quote;
    var qlen = collapse(q).trim().length;
    var home = blockById(it.p);
    var homeCount = 0;
    if (home) {
      var t = blockText(home);
      if (typeof it.start === "number" && it.start >= 0 && t.substr(it.start, q.length) === q) {
        var ex = { block: home, s: it.start, e: it.start + q.length, score: contextScore(t, it.start, it.start + q.length, it) };
        if (agrees(ex, it, t)) return ex;
      }
      var hit = bestIn(home, t, it, typeof it.start === "number" ? it.start : null);
      if (hit) {
        homeCount = hit.count;
        if (agrees(hit, it, t) || (hit.count === 1 && qlen >= UNIQUE_MIN)) return hit;
      }
    }
    var best = null;
    var total = 0;
    for (var i = 0; i < blockList.length; i++) {
      var b = blockList[i];
      if (b === home || !article.contains(b)) continue;
      var h = bestIn(b, blockText(b), it, null);
      if (!h) continue;
      total += h.count;
      if (!best || h.score > best.score) best = h;
    }
    if (!best) return null;
    if (agrees(best, it, blockText(best.block))) return best;
    if (total === 1 && homeCount === 0 && qlen >= UNIQUE_MIN) return best;
    return null;
  }

  // ---------- marks in the page ----------
  function makeMark(it) {
    var m = document.createElement("mark");
    m.className = "ad-mark";
    m.setAttribute("data-color", colorOf(it));
    m.setAttribute("data-mid", it.id);
    if (hasNote(it)) m.setAttribute("data-noted", "");
    return m;
  }

  function wrap(block, s, e, it) {
    var segs = segments(block);
    var made = [];
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (seg.end <= s || seg.start >= e) continue;
      var m;
      if (seg.math) {
        // a formula is wrapped whole, from outside, and only when the selection covers all of it
        if (seg.start >= s && seg.end <= e && !seg.node.classList.contains("block") && seg.node.parentNode) {
          m = makeMark(it);
          seg.node.parentNode.insertBefore(m, seg.node);
          m.appendChild(seg.node);
          made.push(m);
        }
        continue;
      }
      var node = seg.node;
      var a = Math.max(s, seg.start) - seg.start;
      var b = Math.min(e, seg.end) - seg.start;
      if (!/\S/.test(node.data.slice(a, b)) || !node.parentNode) continue;
      if (b < node.data.length) node.splitText(b);
      if (a > 0) node = node.splitText(a);
      m = makeMark(it);
      node.parentNode.insertBefore(m, node);
      m.appendChild(node);
      made.push(m);
    }
    if (made.length) made[0].setAttribute("tabindex", "0");
    return made;
  }

  function unwrap(m) {
    var parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    try { parent.normalize(); } catch (e) { /* nothing to merge */ }
  }

  function marksOf(id) {
    var r = rt[id];
    return r ? r.marks.filter(function (m) { return m.isConnected !== false && document.contains(m); }) : [];
  }

  function setMarkState(it) {
    marksOf(it.id).forEach(function (m) {
      m.setAttribute("data-color", colorOf(it));
      if (hasNote(it)) m.setAttribute("data-noted", "");
      else m.removeAttribute("data-noted");
    });
  }

  function restoreAll() {
    rt = {};
    textCache = typeof Map === "function" ? new Map() : null;
    var changed = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!valid(it)) continue; // kept in storage as it is, just not shown
      if (typeof it.id !== "string" || !it.id || rt[it.id]) { it.id = newId(); changed = true; }
      var r = rt[it.id] = { marks: [], block: null, orphan: false };
      var hit = locate(it);
      if (!hit) {
        r.orphan = true;
        r.block = blockById(it.p);
        continue;
      }
      r.block = hit.block;
      r.marks = wrap(hit.block, hit.s, hit.e, it);
      var pid = hit.block.getAttribute("data-p");
      if (pid !== it.p || hit.s !== it.start) { it.p = pid; it.start = hit.s; changed = true; }
    }
    textCache = null;
    if (changed) save();
    renderCards();
    updateDock();
  }

  function unwrapAll() {
    Array.prototype.forEach.call(article.querySelectorAll("mark.ad-mark"), unwrap);
    rt = {};
  }

  // ---------- small DOM helpers ----------
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function ui(el, name) { el.setAttribute(UI, name || "desk"); return el; }
  function button(cls, text, label) {
    var b = h("button", cls, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    return b;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function closeIcon() {
    var s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    s.setAttribute("width", "14");
    s.setAttribute("height", "14");
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M4 4l8 8M12 4l-8 8");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "2");
    p.setAttribute("stroke-linecap", "round");
    s.appendChild(p);
    return s;
  }
  // The closed <details> elements that hide el (its own summary stays visible). Checked by hand,
  // because some browsers still report boxes for the content of a closed details.
  function closedAround(el) {
    var out = [];
    var d = el && el.closest ? el.closest("details") : null;
    while (d) {
      if (!d.open) {
        var s = el.closest("summary");
        if (!(s && s.parentElement === d)) out.push(d);
      }
      d = d.parentElement ? d.parentElement.closest("details") : null;
    }
    return out;
  }
  function rendered(el) {
    if (!el || !document.contains(el)) return false;
    if (el.closest("[hidden], [data-depth-hidden]")) return false;
    if (closedAround(el).length) return false;
    return el.getClientRects().length > 0;
  }
  function excerpt(t, n) {
    t = collapse(t).trim();
    return t.length > n ? t.slice(0, n - 1).trim() + "…" : t;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function viewW() { return document.documentElement.clientWidth || window.innerWidth; }
  function viewH() { return window.innerHeight || document.documentElement.clientHeight; }

  function copyText(t) {
    return new Promise(function (resolve) {
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = t;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        resolve(ok);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) {
          navigator.clipboard.writeText(t).then(function () { resolve(true); }, fallback);
          return;
        }
      } catch (e) { /* fall through */ }
      fallback();
    });
  }

  function feedback(btn, ok, after) {
    var old = btn.textContent;
    btn.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(function () {
      btn.textContent = old;
      if (after) after();
    }, ok ? 900 : 1600);
  }

  // ---------- margin notes ----------
  var layer = ui(h("div", "ad-margin"), "desk");
  layer.setAttribute("aria-label", "Margin notes");
  var cards = []; // {el, id, block, orphan, order}

  function sortedItems() {
    var anchored = [];
    var orphans = [];
    items.forEach(function (it) {
      if (!valid(it) || !rt[it.id]) return;
      (rt[it.id].orphan ? orphans : anchored).push(it);
    });
    anchored.sort(function (a, b) {
      var ma = marksOf(a.id)[0] || rt[a.id].block;
      var mb = marksOf(b.id)[0] || rt[b.id].block;
      if (ma && mb && ma !== mb) {
        var pos = ma.compareDocumentPosition(mb);
        if (pos & 4) return -1;
        if (pos & 2) return 1;
      }
      return (a.start || 0) - (b.start || 0);
    });
    return anchored.concat(orphans);
  }

  function makeCard(it, orphan) {
    var c = ui(h("div", "ad-note"), "desk");
    c.setAttribute("data-color", colorOf(it));
    c.setAttribute("data-mid", it.id);
    c.setAttribute("role", "button");
    c.setAttribute("tabindex", "0");
    if (orphan) {
      c.setAttribute("data-orphan", "");
      c.appendChild(h("span", "ad-label", "Original text changed"));
      c.appendChild(h("small", null, collapse(it.quote).trim()));
    } else {
      c.appendChild(h("small", null, excerpt(it.quote, 72)));
    }
    if (hasNote(it)) c.appendChild(h("div", "ad-note-text", noteOf(it)));
    c.setAttribute("aria-label", orphan ? "Note on changed text, open" : "Note, open");
    return c;
  }

  function inlineSpot(block) {
    var tag = block.tagName;
    if (tag === "LI" || tag === "TD" || tag === "TH") {
      for (var c = block.firstElementChild; c; c = c.nextElementSibling) {
        if (c.tagName === "UL" || c.tagName === "OL") return { parent: block, before: c };
      }
      return { parent: block, before: null };
    }
    if (tag === "SUMMARY" && block.parentNode && block.parentNode.parentNode) {
      // after the whole callout, so the note shows while the callout is closed
      var det = block.parentNode;
      return { parent: det.parentNode, before: det.nextSibling };
    }
    return { parent: block.parentNode, before: block.nextSibling };
  }

  function topSpot() {
    var first = article.firstElementChild;
    if (first && first.tagName === "H1") {
      var next = first.nextElementSibling;
      while (next && next.hasAttribute(UI) && !next.classList.contains("ad-note")) next = next.nextElementSibling;
      return { parent: article, before: next };
    }
    return { parent: article, before: article.firstChild };
  }

  function renderCards() {
    cards.forEach(function (c) { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    cards = [];
    var wide = isWide();
    var list = sortedItems().filter(function (it) { return rt[it.id].orphan || hasNote(it); });
    list.forEach(function (it, i) {
      var r = rt[it.id];
      var block = r.block && document.contains(r.block) ? r.block : null;
      cards.push({ el: makeCard(it, r.orphan), id: it.id, block: block, orphan: r.orphan, order: i });
    });
    if (wide) {
      if (!layer.parentNode) document.body.appendChild(layer);
      cards.forEach(function (c) { layer.appendChild(c.el); });
    } else {
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      // group by block, keep order; blocks in document order because the list already is
      var done = typeof Map === "function" ? new Map() : null;
      var tops = cards.filter(function (c) { return !c.block; });
      if (tops.length) {
        var ts = topSpot();
        tops.forEach(function (c) { ts.parent.insertBefore(c.el, ts.before); });
      }
      cards.forEach(function (c) {
        if (!c.block) return;
        var spot = done && done.get(c.block);
        if (!spot) {
          spot = inlineSpot(c.block);
          if (done) done.set(c.block, spot);
        }
        if (spot.parent) spot.parent.insertBefore(c.el, spot.before);
      });
    }
    scheduleLayout();
  }

  function cardAnchorTop(c, articleTop) {
    if (!c.block) return articleTop;
    var m = marksOf(c.id)[0];
    var target = m && rendered(m) ? m : c.block;
    return target.getBoundingClientRect().top + window.pageYOffset;
  }

  function layout() {
    if (!cards.length) return;
    if (!isWide()) {
      cards.forEach(function (c) {
        var show = !c.block || rendered(c.block);
        if (c.el.hidden === show) c.el.hidden = !show;
      });
      return;
    }
    var ar = article.getBoundingClientRect();
    var sx = window.pageXOffset;
    var articleTop = ar.top + window.pageYOffset;
    var gap = 28;
    var width = Math.floor(Math.min(256, viewW() - ar.right - gap - 16));
    if (width < 150) width = 150;
    var entries = [];
    cards.forEach(function (c) {
      var vis = !c.block || rendered(c.block);
      c.el.hidden = !vis;
      if (!vis) return;
      c.el.style.left = Math.round(ar.right + sx + gap) + "px";
      c.el.style.width = width + "px";
      entries.push({ c: c, top: cardAnchorTop(c, articleTop) });
    });
    entries.sort(function (a, b) { return a.top - b.top || a.c.order - b.c.order; });
    var heights = entries.map(function (e) { return e.c.el.offsetHeight; });
    var floor = -Infinity;
    entries.forEach(function (e, i) {
      var top = Math.max(e.top, floor);
      e.c.el.style.top = Math.round(top) + "px";
      floor = top + heights[i] + 8;
    });
  }

  // Next frame, or after 120 ms when frames are not being delivered (hidden tab), whichever is first.
  var layoutQueued = false;
  var layoutTimer = 0;
  function runLayout() {
    if (!layoutQueued) return;
    layoutQueued = false;
    clearTimeout(layoutTimer);
    try { layout(); } catch (e) { /* a block left the page mid-layout */ }
  }
  function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(runLayout);
    layoutTimer = setTimeout(runLayout, 120);
  }

  // ---------- selection pill ----------
  var pill = ui(h("div", "ad-select"), "desk");
  pill.setAttribute("role", "toolbar");
  pill.setAttribute("aria-label", "Selection");
  pill.hidden = true;
  var pillSel = null;

  function samePill(sel) {
    if (!pillSel || pill.hidden) return false;
    if (sel.cross || pillSel.cross) return !!(sel.cross && pillSel.cross);
    return sel.block === pillSel.block && sel.s === pillSel.s && sel.e === pillSel.e;
  }

  function showPill(sel) {
    if (samePill(sel)) { pillSel = sel; return; }
    pillSel = sel;
    pill.textContent = "";
    if (sel.cross) {
      pill.appendChild(h("span", "ad-msg", "Select inside one paragraph, item or cell"));
    } else {
      var hl = h("span", "ad-hl");
      COLORS.forEach(function (col) {
        var b = button("ad-act ad-sw", null, "Highlight " + COLOR_NAME[col].toLowerCase());
        b.setAttribute("data-color", col);
        b.setAttribute("data-act", "hl");
        hl.appendChild(b);
      });
      pill.appendChild(hl);
      var note = button("ad-act", "Note");
      note.setAttribute("data-act", "note");
      pill.appendChild(note);
      var copy = button("ad-act", "Copy quote");
      copy.setAttribute("data-act", "copy");
      pill.appendChild(copy);
    }
    if (!pill.parentNode) document.body.appendChild(pill);
    pill.hidden = false;
    placeFloat(pill, sel.rect, coarse() ? "below" : "above", 10);
  }

  function hidePill() {
    pill.hidden = true;
    pillSel = null;
  }

  // Position an absolutely placed floating element next to a viewport rect.
  function placeFloat(el, rect, prefer, gapPx) {
    var w = el.offsetWidth;
    var hgt = el.offsetHeight;
    var vw = viewW();
    var vh = viewH();
    var barRoom = 64; // the sticky top bar
    var above = rect.top - hgt - gapPx;
    var below = rect.bottom + gapPx;
    var top;
    if (prefer === "above") top = above >= barRoom ? above : below;
    else top = below + hgt <= vh - 8 || above < barRoom ? below : above;
    var left = clamp(rect.left + rect.width / 2 - w / 2, 8, Math.max(8, vw - w - 8));
    el.style.top = Math.round(top + window.pageYOffset) + "px";
    el.style.left = Math.round(left + window.pageXOffset) + "px";
  }

  function addFromSelection(sel, color) {
    var it = {
      id: newId(),
      p: sel.block.getAttribute("data-p"),
      quote: sel.quote,
      prefix: sel.text.slice(Math.max(0, sel.s - CONTEXT), sel.s),
      suffix: sel.text.slice(sel.e, sel.e + CONTEXT),
      start: sel.s,
      color: color,
      note: "",
      at: new Date().toISOString()
    };
    var made = wrap(sel.block, sel.s, sel.e, it);
    if (!made.length) return null; // nothing visible to anchor to (a display formula alone)
    items.push(it);
    rt[it.id] = { marks: made, block: sel.block, orphan: false };
    save();
    try { window.getSelection().removeAllRanges(); } catch (e) { /* nothing selected */ }
    updateDock();
    scheduleLayout();
    return it;
  }

  pill.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the selection
  pill.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button[data-act]") : null;
    if (!b || !pillSel || pillSel.cross) return;
    var act = b.getAttribute("data-act");
    var sel = pillSel;
    if (act === "copy") {
      copyText(collapse(sel.quote).trim()).then(function (ok) {
        feedback(b, ok, function () { if (pillSel === sel) hidePill(); });
      });
      return;
    }
    var it = addFromSelection(sel, act === "hl" ? b.getAttribute("data-color") : "yellow");
    hidePill();
    if (it && act === "note") openPop(it.id, null, true);
  });

  var selTimer = 0;
  var dragging = false;
  function checkSelection() {
    clearTimeout(selTimer);
    selTimer = 0;
    if (!started) { hidePill(); return; } // stored marks are not back yet
    var sel = null;
    try { sel = readSelection(); } catch (e) { sel = null; }
    if (!sel) { hidePill(); return; }
    if (pop) closePop();
    showPill(sel);
  }

  document.addEventListener("pointerdown", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (pop && !pop.contains(t) && !t.closest(".ad-mark") && !t.closest(".ad-note")) closePop();
    if (panelOpen() && !panel.contains(t) && !dock.contains(t)) closePanel();
    if (!pill.hidden && !pill.contains(t)) hidePill();
    if (e.pointerType === "mouse" && e.button === 0 && !t.closest("[" + UI + "]")) dragging = true;
  }, true);

  document.addEventListener("pointerup", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("[" + UI + "]") && !dragging) return;
    dragging = false;
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, 10);
  });

  document.addEventListener("selectionchange", function () {
    if (dragging) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, coarse() ? 400 : 250);
  });

  // ---------- popover for one mark ----------
  var pop = null;
  var popId = null;
  var popTimer = 0;
  var popReturn = null;

  function flushNote() {
    if (!popTimer) return;
    clearTimeout(popTimer);
    popTimer = 0;
    save();
    renderCards();
  }

  function closePop(noFlush) {
    if (!pop) return;
    if (noFlush !== true) flushNote();
    if (pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
    popId = null;
    var back = popReturn;
    popReturn = null;
    if (back && document.contains(back) && back.focus) {
      try { back.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
    }
  }

  function anchorRect(id, fallbackEl) {
    var ms = marksOf(id).filter(rendered);
    if (ms.length) {
      var a = ms[0].getBoundingClientRect();
      var z = ms[ms.length - 1].getBoundingClientRect();
      var left = Math.min(a.left, z.left);
      var right = Math.max(a.right, z.right);
      return { top: a.top, bottom: z.bottom, left: left, right: right, width: right - left, height: z.bottom - a.top };
    }
    if (fallbackEl && rendered(fallbackEl)) return fallbackEl.getBoundingClientRect();
    return null;
  }

  function openPop(id, fromEl, focusNote) {
    var it = byId(id);
    if (!it) return;
    closePop();
    hidePill();
    var r = rt[id] || { marks: [], orphan: true };
    popId = id;
    popReturn = fromEl || marksOf(id)[0] || null;

    pop = ui(h("div", "ad-pop"), "desk");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", r.orphan ? "Note on changed text" : "Highlight");
    pop.tabIndex = -1;

    var head = h("div", "ad-pop-head");
    head.appendChild(h("span", "ad-label", r.orphan ? "Original text changed" : "Highlight"));
    var x = button("ad-x", null, "Close");
    x.appendChild(closeIcon());
    x.addEventListener("click", closePop);
    head.appendChild(x);
    pop.appendChild(head);

    if (r.orphan) pop.appendChild(h("p", "ad-quote", collapse(it.quote).trim()));

    var sw = h("div", "ad-hl");
    sw.setAttribute("role", "group");
    sw.setAttribute("aria-label", "Colour");
    COLORS.forEach(function (col) {
      var b = button("ad-act ad-sw", null, COLOR_NAME[col]);
      b.setAttribute("data-color", col);
      b.setAttribute("aria-pressed", String(colorOf(it) === col));
      b.addEventListener("click", function () {
        it.color = col;
        setMarkState(it);
        Array.prototype.forEach.call(sw.children, function (o) {
          o.setAttribute("aria-pressed", String(o.getAttribute("data-color") === col));
        });
        save();
        renderCards();
        updateDock();
      });
      sw.appendChild(b);
    });
    pop.appendChild(sw);

    var ta = h("textarea", "ad-input");
    ta.setAttribute("aria-label", "Note");
    ta.placeholder = "Add a note";
    ta.rows = 3;
    ta.value = noteOf(it);
    ta.addEventListener("input", function () {
      it.note = ta.value;
      setMarkState(it);
      clearTimeout(popTimer);
      popTimer = setTimeout(function () { popTimer = 0; save(); renderCards(); updateDock(); }, 300);
    });
    ta.addEventListener("blur", flushNote);
    pop.appendChild(ta);
    var warn = h("p", "ad-warn ad-pop-warn", "Not saved in this browser. Copy your marks to keep them.");
    warn.hidden = !saveFailed;
    pop.appendChild(warn);

    var foot = h("div", "ad-pop-foot");
    var rm = button("ad-act ad-restore", r.orphan ? "Remove" : "Restore original");
    var armed = false;
    var armTimer = 0;
    rm.addEventListener("click", function () {
      var noted = hasNote(it);
      var needsTwo = r.orphan || noted;
      if (needsTwo && !armed) {
        armed = true;
        rm.textContent = noted
          ? (r.orphan ? "Press again to remove it and its note" : "Press again to remove the note too")
          : (r.orphan ? "Press again to remove" : "Press again to restore");
        clearTimeout(armTimer);
        armTimer = setTimeout(function () {
          armed = false;
          rm.textContent = r.orphan ? "Remove" : "Restore original";
        }, 4000);
        return;
      }
      clearTimeout(armTimer);
      removeItem(id);
    });
    foot.appendChild(rm);
    pop.appendChild(foot);

    document.body.appendChild(pop);
    var rect = anchorRect(id, fromEl) || article.getBoundingClientRect();
    placeFloat(pop, rect, "below", 8);
    try {
      if (focusNote) ta.focus({ preventScroll: true });
      else pop.focus({ preventScroll: true });
    } catch (e) { /* old browser */ }
  }

  function removeItem(id) {
    clearTimeout(popTimer);
    popTimer = 0;
    marksOf(id).forEach(unwrap);
    for (var i = items.length - 1; i >= 0; i--) {
      if (valid(items[i]) && items[i].id === id) items.splice(i, 1);
    }
    delete rt[id];
    popReturn = null;
    save();
    closePop();
    renderCards();
    updateDock();
    if (panelOpen()) fillPanel();
  }

  article.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var card = t.closest(".ad-note");
    if (card) {
      if (card.closest("summary")) e.preventDefault(); // do not also open or close the callout
      openPop(card.getAttribute("data-mid"), card, false);
      return;
    }
    var m = t.closest("mark.ad-mark");
    if (!m) return;
    if (t.closest("a") && article.contains(t.closest("a"))) return; // links keep working
    var sel = window.getSelection ? window.getSelection() : null;
    if (sel && !sel.isCollapsed) return;
    if (m.closest("summary")) e.preventDefault(); // do not also open or close the callout
    openPop(m.getAttribute("data-mid"), m, false);
  });

  layer.addEventListener("click", function (e) {
    var card = e.target.closest ? e.target.closest(".ad-note") : null;
    if (card) openPop(card.getAttribute("data-mid"), card, false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Esc") {
      if (pop) { closePop(); return; }
      if (panelOpen()) { closePanel(); dock.focus(); return; }
      if (!pill.hidden) hidePill();
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    var t = e.target;
    if (!t || !t.matches) return;
    if (t.matches("mark.ad-mark[tabindex]") || t.matches(".ad-note[data-mid]")) {
      e.preventDefault();
      openPop(t.getAttribute("data-mid"), t, false);
    }
  });

  // ---------- the "Marks" pill and list ----------
  var dock = ui(button("ad-dock", null), "desk");
  dock.setAttribute("aria-expanded", "false");
  dock.appendChild(h("span", null, "Marks"));
  var dockCount = h("span", "ad-count");
  dock.appendChild(dockCount);
  var dockUnsaved = h("span", "ad-unsaved", "Not saved");
  dockUnsaved.hidden = true;
  dock.appendChild(dockUnsaved);
  dock.hidden = true;

  // Saving failed (storage blocked or full): say so where the reader is acting, not only in the list.
  function showSaveState() {
    if (dock) {
      dockUnsaved.hidden = !saveFailed;
      if (saveFailed) dock.setAttribute("data-unsaved", "");
      else dock.removeAttribute("data-unsaved");
      dock.setAttribute("aria-label", "Marks, " + visibleCount() + (saveFailed ? ", not saved" : ""));
    }
    if (pop) {
      var w = pop.querySelector(".ad-pop-warn");
      if (w) w.hidden = !saveFailed;
    }
  }

  var panel = ui(h("div", "ad-list"), "desk");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Marks");
  panel.tabIndex = -1;
  panel.hidden = true;

  function panelOpen() { return !panel.hidden; }

  function visibleCount() {
    var n = 0;
    items.forEach(function (it) { if (valid(it) && rt[it.id]) n++; });
    return n;
  }

  function updateDock() {
    var n = visibleCount();
    if (!dock.parentNode) document.body.appendChild(dock);
    if (!panel.parentNode) document.body.appendChild(panel);
    var any = n > 0 || backups.length > 0;
    dock.hidden = !any;
    dockCount.textContent = String(n);
    showSaveState();
    if (!any) closePanel();
    else if (panelOpen()) fillPanel();
  }

  function fillPanel() {
    panel.textContent = "";
    var head = h("div", "ad-list-head");
    head.appendChild(h("span", "ad-label", "Marks"));
    var copy = button("ad-act ad-copy", "Copy as Markdown");
    copy.addEventListener("click", function () {
      copyText(markdown()).then(function (ok) { feedback(copy, ok); });
    });
    head.appendChild(copy);
    panel.appendChild(head);
    if (saveFailed) panel.appendChild(h("p", "ad-warn", "Not saved in this browser. Copy them to keep them."));
    if (backups.length) {
      // K4: earlier data that could not be read is kept, and the reader can take it back.
      var kept = h("div", "ad-kept");
      kept.appendChild(h("p", "ad-warn", "Earlier marks for this note could not be read. A copy was kept in this browser."));
      var copyKept = button("ad-act ad-copy", "Copy kept data");
      copyKept.addEventListener("click", function () {
        copyText(backups.join("\n\n")).then(function (ok) { feedback(copyKept, ok); });
      });
      kept.appendChild(copyKept);
      panel.appendChild(kept);
    }
    var ul = h("ul", "ad-items");
    sortedItems().forEach(function (it) {
      var r = rt[it.id];
      var li = h("li");
      var b = button("ad-item");
      b.setAttribute("data-color", colorOf(it));
      b.setAttribute("data-mid", it.id);
      if (r.orphan) {
        b.setAttribute("data-orphan", "");
        b.appendChild(h("span", "ad-label", "Original text changed"));
      }
      b.appendChild(h("span", "ad-q", collapse(it.quote).trim()));
      if (hasNote(it)) b.appendChild(h("span", "ad-n", noteOf(it)));
      b.addEventListener("click", function () { jump(it.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    panel.appendChild(ul);
  }

  function openPanel() {
    closePop();
    hidePill();
    fillPanel();
    panel.hidden = false;
    dock.setAttribute("aria-expanded", "true");
    try { panel.focus({ preventScroll: true }); } catch (e) { panel.focus(); }
  }

  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    dock.setAttribute("aria-expanded", "false");
  }

  dock.addEventListener("click", function () {
    if (panelOpen()) closePanel();
    else openPanel();
  });

  function jump(id) {
    closePanel();
    var r = rt[id];
    if (!r) return;
    var card = null;
    cards.forEach(function (c) { if (c.id === id) card = c.el; });
    var ms = marksOf(id);
    var target = ms[0] || (r.orphan ? card : null) || r.block || card;
    if (!target) return;
    // The place in the note: a margin card sits outside the article, so reveal its block instead.
    var place = article.contains(target) ? target : (r.block && document.contains(r.block) ? r.block : null);
    if (!rendered(target)) {
      // Open any closed callout around it. This is view state only; the note text is untouched (K3).
      [place, target].forEach(function (el) {
        closedAround(el).forEach(function (d) { d.open = true; });
      });
      if (place && !rendered(place)) {
        try { document.dispatchEvent(new CustomEvent("rdg:reveal", { detail: place })); } catch (e) { /* old browser */ }
      }
      layout();
    }
    var flashEls = ms.length ? ms : (card ? [card] : []);
    (window.requestAnimationFrame || setTimeout)(function () {
      if (!rendered(target)) return; // still inside something the reader keeps closed
      try { target.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }); }
      catch (e) { target.scrollIntoView(); }
      flashEls.forEach(function (el) {
        el.classList.remove("ad-flash");
        void el.offsetWidth;
        el.classList.add("ad-flash");
        setTimeout(function () { el.classList.remove("ad-flash"); }, 1600);
      });
      // The popover gives every mark, including one inside link text, its colour, note and remove.
      openPop(id, ms[0] && ms[0].hasAttribute("tabindex") ? ms[0] : (card || target), false);
    });
  }

  function markdown() {
    var h1 = article.querySelector("h1");
    var title = collapse(((h1 && h1.textContent) || document.title || "")).trim();
    var url = location.href.split("#")[0];
    var out = [];
    sortedItems().forEach(function (it) {
      var q = collapse(it.quote).trim();
      out.push("> " + q);
      if (rt[it.id].orphan) { out.push(""); out.push("(Original text changed)"); }
      if (hasNote(it)) { out.push(""); out.push(noteOf(it).trim()); }
      out.push("");
    });
    out.push("[" + title.replace(/([\[\]])/g, "\\$1") + "](" + url + ")");
    return out.join("\n") + "\n";
  }

  // ---------- keeping the margin in step ----------
  function onWideChange() {
    closePop();
    renderCards();
  }
  if (wideMq) {
    if (wideMq.addEventListener) wideMq.addEventListener("change", onWideChange);
    else if (wideMq.addListener) wideMq.addListener(onWideChange);
  }

  window.addEventListener("resize", function () {
    if (!pill.hidden) hidePill();
    scheduleLayout();
  });

  if (window.ResizeObserver) {
    try { new ResizeObserver(scheduleLayout).observe(article); } catch (e) { /* old browser */ }
  }
  if (window.MutationObserver) {
    new MutationObserver(scheduleLayout).observe(article, {
      attributes: true, subtree: true, attributeFilter: ["hidden", "open", "data-depth-hidden"]
    });
  }
  document.addEventListener("toggle", scheduleLayout, true);
  document.addEventListener("rdg:depth", scheduleLayout);
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleLayout); } catch (e) { /* no font API */ }

  // another tab changed this note's marks
  window.addEventListener("storage", function (e) {
    if (e.key !== KEY && e.key !== null) return;
    if (!started) { items = load(); return; } // start() puts the marks in the page once
    // Merge, never overwrite: keep this tab's unsaved note, take everything else from the other tab.
    var openId = popId;
    var pendingId = popTimer ? popId : null;
    var pendingIt = pendingId ? byId(pendingId) : null;
    var pendingNote = pendingIt ? noteOf(pendingIt) : null;
    var typing = !!(pop && document.activeElement && pop.contains(document.activeElement) &&
      document.activeElement.tagName === "TEXTAREA");
    clearTimeout(popTimer);
    popTimer = 0;
    closePop(true);
    hidePill();
    unwrapAll();
    items = load();
    if (pendingId !== null) {
      var fresh = byId(pendingId);
      if (fresh && noteOf(fresh) !== pendingNote) { fresh.note = pendingNote; save(); }
    }
    restoreAll();
    if (openId && byId(openId) && rt[openId]) {
      var c = null;
      cards.forEach(function (x) { if (x.id === openId) c = x.el; });
      openPop(openId, marksOf(openId)[0] || c, typing);
      if (typing && pop) {
        var ta = pop.querySelector("textarea");
        if (ta) { try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (err) { /* not a text field */ } }
      }
    }
  });

  // Keep a note typed just before the tab closes, reloads or goes to the background.
  window.addEventListener("pagehide", flushNote);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushNote();
  });

  // ---------- start: restore once KaTeX has rendered (it runs on DOMContentLoaded) ----------
  var started = false;
  function start() {
    if (started) return;
    started = true;
    try { restoreAll(); } catch (e) { /* a broken entry must not break the page */ }
    setTimeout(scheduleLayout, 1200); // Mermaid and late fonts
  }
  if (document.readyState === "complete") setTimeout(start, 0);
  else window.addEventListener("load", start);
})();
