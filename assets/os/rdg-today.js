/* Reading OS · rdg-today.js
   The Today app: one small window with the latest daily report, rereads that are due (up to 5) and up to 3 notes
   you are reading, each with a Reread done button where one is due. It reads and writes the same keys as the
   Shelf's board through window.RDG (rdg-core.js), so a reread marked here shows on the board at its next storage
   event, and the other way round.
   K1: no counts, no lateness, no badges, no Dock attention. When nothing is due it says "Nothing due today." */
(function (A) {
  "use strict";
  var RDG = window.RDG;
  if (!A || !A.apps || !A.wm || !RDG) return;
  var esc = A.esc || function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var R = A.reading = A.reading || {};

  A.css("rdg-today",
    ".rdg-today { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--surface, #faf9f6); color: var(--ink) }\n" +
    ".rdg-today .td-h { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 14px 18px 8px; border-bottom: 1.5px solid var(--ink); margin: 0 14px }\n" +
    ".rdg-today .td-h h2 { margin: 0; font: 700 22px/1.05 var(--sans); letter-spacing: -0.02em }\n" +
    ".rdg-today .td-h .lbl { white-space: nowrap }\n" +
    ".rdg-today .td-list { list-style: none; margin: 0; padding: 8px 8px 12px; overflow: auto; flex: 1 1 auto; min-height: 0 }\n" +
    ".rdg-today .td-row { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px; border-radius: 12px; cursor: pointer }\n" +
    ".rdg-today .td-row:hover, .rdg-today .td-row:focus-visible { background: rgba(35,34,29,.06) }\n" +
    ".rdg-today .td-row:focus-visible { outline: 2px solid var(--focus, #2b5d86); outline-offset: -2px }\n" +
    ".rdg-today .td-mini { width: 30px; height: 42px; border-radius: 5px; background: var(--cc); box-shadow: 0 0 0 2px var(--plate), 0 0 0 3px var(--line); position: relative }\n" +
    ".rdg-today .td-mini.core::after { content: \"\"; position: absolute; right: 4px; top: 4px; width: 4px; height: 4px; border-radius: 50%; background: #fffdf6 }\n" +
    ".rdg-today .td-mini.slot { background: var(--well, #f1efe9); outline: 1.5px dashed var(--line-strong, #8a8474); outline-offset: -5px }\n" +
    ".rdg-today .td-t { display: grid; gap: 1px; min-width: 0 }\n" +
    ".rdg-today .td-a { font: 700 10px/13px var(--sans); letter-spacing: .1em; text-transform: uppercase }\n" +
    ".rdg-today .td-n { font: 700 14px/1.15 var(--sans); letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }\n" +
    ".rdg-today .td-f { font: 500 11px/14px var(--sans); color: var(--muted); display: flex; align-items: center; gap: 4px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }\n" +
    ".rdg-today .td-f::before { content: \"\"; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ch) }\n" +
    ".rdg-today .td-row.seen .td-a, .rdg-today .td-row.seen .td-n { color: var(--muted) }\n" +
    ".rdg-today .td-row.seen .td-mini { filter: grayscale(.6) }\n" +
    ".rdg-today .td-ok { width: 26px; height: 26px; display: grid; place-items: center; color: var(--done, #3a9660) }\n" +
    ".rdg-today .td-rr { font: 600 11.5px/16px var(--sans); padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line-strong, #8a8474); background: rgba(255,255,255,.6); color: var(--ink); white-space: nowrap; cursor: pointer; transition: background .15s var(--ease), color .15s var(--ease), transform .2s var(--ease) }\n" +
    ".rdg-today .td-rr:hover, .rdg-today .td-rr:focus-visible { background: var(--ink); color: var(--plate); border-color: var(--ink) }\n" +
    ".rdg-today .td-rr:active { transform: scale(.96) }\n" +
    ".rdg-today .td-none { list-style: none; padding: 4px 6px 8px; color: var(--muted); font-size: 12.5px; line-height: 17px }\n" +
    ".rdg-today .td-foot { margin: 0 14px; padding: 9px 4px 12px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end }\n" +
    ".rdg-today .td-link { font: 500 12px/16px var(--sans); color: var(--muted); background: none; border: 0; padding: 4px 8px; border-radius: 8px; cursor: pointer }\n" +
    ".rdg-today .td-link:hover { color: var(--ink); background: rgba(35,34,29,.06) }\n");

  /* the board's colours: Atlas's twelve field colours and three more, by chapter number (build_site.py BOARD_PAL) */
  var PAL = (A.PAL || ["#3d4a6b", "#74404d", "#2c5c58", "#4d5a31", "#80502c", "#2c5175", "#5d4b7c", "#33603f", "#86591d", "#6c3a60", "#3e5561", "#7b3a34"]).concat(["#5a5340", "#2f5a6b", "#6b4a5a"]);
  function colour(ch) { var i = (+ch || 1) - 1; return PAL[((i % PAL.length) + PAL.length) % PAL.length]; }
  function chapters() { var m = {}; ((RDG.catalog() || {}).chapters || []).forEach(function (c) { m[c.n] = c.title || ""; }); return m; }
  function shortT(n) { var t = String(n.title || "").split(/[:：]/)[0]; return t.length > 46 ? t.slice(0, 44) + "…" : t; }
  function who(n) { return n.prefix === "00" ? "Index" : String(n.prefix || ""); }
  function mini(n) { return n.plan ? '<span class="td-mini slot"></span>' : '<span class="td-mini' + (n.tier === "core" ? " core" : "") + '" style="--cc:' + colour(n.ch) + '"></span>'; }
  var LBL = { daily: "Daily report", reread: "Reread", cont: "Continue" };
  var CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function rowHTML(x, chs) {
    var n = x.n, kicker = LBL[x.k] + (x.k === "daily" ? "" : " · " + who(n)), field = String(chs[n.ch] || "").split(":")[0];
    var end = x.k === "reread" ? '<button class="td-rr" type="button" data-rr="' + esc(n.id) + '" aria-label="' + esc("Reread of " + shortT(n) + " done") + '">Reread done</button>'
      : x.k === "daily" && x.seen ? '<span class="td-ok" role="img" aria-label="Opened">' + CHECK + "</span>" : "<span></span>";
    return '<li class="td-row k-' + x.k + (x.seen ? " seen" : "") + '" data-id="' + esc(n.id) + '" tabindex="0">' + mini(n) +
      '<span class="td-t"><span class="td-a">' + esc(kicker) + '</span><span class="td-n">' + esc(shortT(n)) + '</span><span class="td-f" style="--ch:' + colour(n.ch) + '">' + esc(field) + "</span></span>" + end + "</li>";
  }
  function listHTML() {
    var items = RDG.todayItems(), chs = chapters(), due = RDG.hasDue(items), h = "", none = false;
    // the same order as the board's Today: the report, then rereads, then "Nothing due today." before Continue
    items.forEach(function (x) {
      if (x.k === "cont" && !none && !due) { h += '<li class="td-none">Nothing due today.</li>'; none = true; }
      h += rowHTML(x, chs);
    });
    if (!none && !due) h += '<li class="td-none">Nothing due today.</li>';
    return h;
  }
  function dateLabel() { var d = new Date(); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]; }

  /* ---------- the window ---------- */
  var win = null, body = null, list = null, lastHTML = null, unsub = null, dayT = 0;
  function render() {
    if (!win || win.closing || !list) return;
    var h = listHTML(); if (h === lastHTML) return;
    // keep the keyboard on the same row (or its button), else on the row that took its place
    var ae = document.activeElement, had = !!ae && list.contains(ae), li0 = had && ae.closest ? ae.closest("li[data-id]") : null;
    var key = li0 ? li0.getAttribute("data-id") : null, onBtn = had && !!ae.closest(".td-rr"), idx = li0 ? Array.prototype.indexOf.call(list.querySelectorAll("li[data-id]"), li0) : 0;
    lastHTML = h; list.innerHTML = h;
    var dl = body.querySelector(".td-h .lbl"); if (dl) dl.textContent = dateLabel();
    if (!had) return;
    var rows = list.querySelectorAll("li[data-id]"), t = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].getAttribute("data-id") === key) { t = rows[i]; break; }
    if (t && onBtn) t = t.querySelector(".td-rr") || t;
    if (!t && rows.length) t = rows[Math.min(Math.max(idx, 0), rows.length - 1)];
    focusEl(t || list);
  }
  function focusEl(el) { if (!el) return; if (el === list) list.setAttribute("tabindex", "-1"); try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  function openNote(id) {
    var n = RDG.notesIndex()[id]; if (!n) return;
    RDG.markDaily(id);
    if (R.openNote) { R.openNote(id); return; }
    if (n.href) location.href = n.href;
  }
  function done(id) {
    var r = RDG.rereadDone(id); if (!r) return;
    var n = RDG.notesIndex()[id], name = n ? who(n) || shortT(n) : id;
    A.toast(r.complete ? name + ": rereads complete" : name + ": next reread in " + r.nextDays + " days");
    if (R.log) { try { R.log("reread", id); } catch (e) {} }
    render();
  }
  function build() {
    body = A.el("div", "rdg-today");
    body.innerHTML = '<div class="td-h"><h2>Today</h2><span class="lbl">' + esc(dateLabel()) + '</span></div><ul class="td-list" aria-label="Today"></ul>' +
      '<div class="td-foot"><button class="td-link" type="button" data-act="shelf">Show the Shelf</button></div>';
    list = body.querySelector(".td-list");
    body.addEventListener("click", function (e) {
      var b = e.target.closest(".td-rr[data-rr]"); if (b) { e.stopPropagation(); done(b.getAttribute("data-rr")); return; }
      if (e.target.closest('[data-act="shelf"]')) { if (R.showShelf) R.showShelf(); return; }
      var li = e.target.closest("li[data-id]"); if (li) openNote(li.getAttribute("data-id"));
    });
    body.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var li = e.target.closest ? e.target.closest("li[data-id]") : null;
      if (e.key === "Enter" && li && !e.target.closest("button")) { e.preventDefault(); openNote(li.getAttribute("data-id")); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        var rows = Array.prototype.slice.call(list.querySelectorAll("li[data-id]")); if (!rows.length) return;
        var i = li ? rows.indexOf(li) : -1, j = e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
        e.preventDefault(); focusEl(rows[j]);
      }
    });
    return body;
  }
  function open(app, o) {
    o = o || {};
    if (win && !win.closing) { if (win.minimized) win.restore(); win.focus(); render(); return win; }
    lastHTML = null;
    win = A.wm.create({
      app: app, title: "Today", w: 380, h: 520, minW: 320, minH: 300, x: o.x, y: o.y, frame: o.frame, body: build(), cls: "rdg-today-win",
      focus: o.focus !== false, raise: o.focus === false,   // a restored Today keeps its place in the stack, without the keyboard
      onFocus: function () { render(); var first = list && list.querySelector("li[data-id]"); if (!list.contains(document.activeElement)) focusEl(first || list); },
      onClosed: function () { if (unsub) unsub(); unsub = null; clearInterval(dayT); win = null; body = list = null; }
    });
    render();
    // the board (Shelf), another tab, or this page changed the reading state; and the day can turn while it is open
    if (!unsub) unsub = RDG.onChange(function (key) { if (key === null || key === "rdg-reread" || key === "rdg-daily-seen" || key === "rdg-progress") render(); });
    clearInterval(dayT); dayT = setInterval(render, 60000);
    return win;
  }

  var app = A.apps.register({
    id: "today", name: "Today", icon: "calendar", accent: "#3a9660", order: 2, cli: "today", quitWhenLastWindowCloses: true,
    desc: "The latest daily report, rereads that are due, and notes you are reading.",
    launch: function (a, args) { open(a, args); },
    reopen: function (a, args) { open(a, args); },
    saveState: function () { return {}; },
    restore: function (a, st, frame) { open(a, { frame: frame, focus: false }); },
    menus: function () {
      // open on the report's /Reading stub opens it in Reader, as the item does (the shell line ⌥ shows)
      var dailyCmd = function () { var d = RDG.daily(), p = d && R.pathOf ? R.pathOf(d.id) : null; return p && A.shPath ? "open " + A.shPath(p) : ""; };
      return [{ title: "Go", items: [
        { label: "Shelf", cmd: "shelf", run: function () { if (R.showShelf) R.showShelf(); } },
        { label: "Latest daily report", disabled: !RDG.daily(), cmd: dailyCmd(), run: function () { var d = RDG.daily(); if (d) openNote(d.id); } }] }];
    }
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) render(); });

  // Today in front (index.html#today, Spotlight's "today", the Go menu, the boot check)
  R.openToday = function () { A.apps.launch(app); };

  if (A.prog) A.prog("today", "Reading", "open Today: the latest daily report, rereads that are due, notes you are reading", "today [list]", async function (p) {
    var sub = p.args[0] || "open";
    if (sub === "open") { R.openToday(); return 0; }
    if (sub !== "list") throw A.usageErr("unknown today command '" + sub + "'");
    var items = RDG.todayItems(), lines = items.map(function (x) { return LBL[x.k] + "\t" + x.n.id + "\t" + shortT(x.n); });
    if (!RDG.hasDue(items)) lines.push("Nothing due today.");
    await p.out(lines.join("\n") + "\n");
    return 0;
  });
})(window.ATLAS);
