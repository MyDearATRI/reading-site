/* Reading OS · After Hours
   The focus timer of Atlas After Hours (Atlas/game/game.js:49-158: state, timeLeft, clock, advance, toggleFocus,
   reset, rewards, focusView, starsView) as a normal window. The night cat, Feed, the bookshelf, the notes vault,
   the companion studio and the wallpaper are left out; so are the treasures the cat kept on the desk, but the
   star chart still lists the three rewards (1, 3 and 5 stars) and which are earned.
   - State lives in the VFS at ~/Library/After Hours/state.json, so it is part of rdg-fs and survives a reload.
   - A star is one finished focus session {id, at, minutes, task}, nothing else. Stars are not Done notes.
   - Lo-fi music is window.AtlasSound (sound.js, synthesized in the page). Nothing makes a sound until the
     person presses Play music.
   - While a session runs the window's state is "reading", and "done" when it ends, so the menu bar's job
     discs show what really happened in this browser. */
(function (A) {
  "use strict";
  if (!A || !A.apps || !A.wm || !A.K) return;
  var K = A.K, FS = K.fs, esc = A.esc || function (s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); };
  var LENGTHS = [1, 5, 15, 25, 45];
  var T = {
    focus: "Focus", stars: "Star chart", free: "Free time", working: "Focusing", paused: "Paused",
    start: "Begin focus", pause: "Pause", resume: "Resume", reset: "End session", length: "Session length", min: "min",
    play: "Play music", stop: "Stop music", wait: "Preparing music…", volume: "Volume",
    saved: "A new star is on your chart.", empty: "Finish a focus session to chart your first star.",
    task: "What are you focusing on?", noSound: "Music cannot play in this browser.", unlock: "Unlocks"
  };
  // game.js rewards(): the same thresholds and English labels, without "beside the cat" (no cat here)
  var REWARDS = [[1, "A brass star"], [3, "A paper moon"], [5, "A tiny constellation"]];

  /* ---------- state, read from the disk the first time it is needed (the disk is mounted at boot) ---------- */
  function prefsDir() { return K.home + "/Library/After Hours"; }
  function stateFile() { return prefsDir() + "/state.json"; }
  var DEFAULTS = { duration: 25, phase: "idle", deadline: 0, remaining: 0, session: "", stars: [], volume: 0.35, focusTask: "", taskAuto: false };
  var state = null;
  function load() {
    if (state) return state;
    var raw = {};
    try { raw = JSON.parse(FS.read(stateFile())) || {}; } catch (e) { raw = {}; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
    state = Object.assign({}, DEFAULTS, raw);
    if (!Array.isArray(state.stars)) state.stars = [];
    state.stars = state.stars.filter(function (s) { return s && typeof s === "object" && isFinite(+s.at); });
    if (LENGTHS.indexOf(+state.duration) < 0) state.duration = 25; else state.duration = +state.duration;
    if (["idle", "running", "paused"].indexOf(state.phase) < 0) state.phase = "idle";
    if (typeof state.focusTask !== "string") state.focusTask = "";
    state.volume = Math.min(1, Math.max(0, +state.volume || 0));
    return state;
  }
  function persist() {
    if (!state) return;
    try { FS.mkdir(prefsDir(), true); FS.write(stateFile(), JSON.stringify(state, null, 1) + "\n"); }
    catch (e) { K.log("afterhours: could not save " + stateFile() + ": " + ((e && e.message) || e), "warn"); }
  }

  /* ---------- the timer (game.js:85-104) ---------- */
  function timeLeft() { return state.phase === "running" ? Math.max(0, state.deadline - Date.now()) : state.phase === "paused" ? Math.max(0, state.remaining) : state.duration * 60000; }
  function clock(ms) { var sec = Math.ceil(ms / 1000); return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); }
  function uid() { try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {} return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  // a running session whose deadline has passed is finished: one star, once
  function advance() {
    if (!state || state.phase !== "running" || Date.now() < state.deadline) return false;
    var task = String(state.focusTask || "").trim();
    if (!state.stars.some(function (s) { return s.id === state.session; })) state.stars.push({ id: state.session, at: state.deadline, minutes: state.duration, task: task });
    state.phase = "idle"; state.session = ""; state.remaining = 0; state.deadline = 0;
    persist();
    if (win && !win.closing) win.setState("done");
    var app = A.apps.get("afterhours");
    if (A.notify) A.notify("After Hours", (task ? task + ". " : "") + T.saved, { app: app, state: "done", action: function () { launch("stars"); } });
    else if (A.toast) A.toast(T.saved);
    return true;
  }
  function toggleFocus() {
    load(); advance();
    if (state.phase === "running") { state.remaining = timeLeft(); state.phase = "paused"; }
    else { if (state.phase !== "paused") { state.session = uid(); state.remaining = state.duration * 60000; } state.deadline = Date.now() + state.remaining; state.phase = "running"; }
    persist(); syncWin(); render();
  }
  function reset() { load(); state.phase = "idle"; state.session = ""; state.deadline = 0; state.remaining = 0; persist(); syncWin(); render(); }

  /* ---------- music: AtlasSound starts only from a press (game.js:97-104) ---------- */
  var audio = false, loadingAudio = false, soundVersion = 0;
  function toggleAudio() {
    var generation = ++soundVersion;
    if (audio || loadingAudio) { audio = false; loadingAudio = false; try { if (window.AtlasSound) window.AtlasSound.stop(); } catch (e) {} render(); return; }
    if (!window.AtlasSound) { if (A.toast) A.toast(T.noSound); return; }
    loadingAudio = true; render();
    Promise.resolve().then(function () { window.AtlasSound.setVolume(load().volume); return window.AtlasSound.start(); })
      .then(function () { if (generation === soundVersion) audio = true; },
            function (e) { if (generation === soundVersion && A.toast) A.toast(T.noSound + ((e && e.message) ? " (" + e.message + ")" : "")); })
      .then(function () { if (generation === soundVersion) { loadingAudio = false; render(); } });
  }
  window.addEventListener("pagehide", function () { if (audio || loadingAudio) { try { window.AtlasSound.stop(); } catch (e) {} } });

  /* ---------- the task: the front Reader's note, until the person types their own ---------- */
  function readerTitle() {
    var ws = A.wm.list().filter(function (w) { return w.app && w.app.id === "reader" && !w.closing && !w.minimized && !w.hidden; })
      .sort(function (a, b) { return (b.lastFocus || 0) - (a.lastFocus || 0); });
    return ws[0] ? String(ws[0].title || "") : "";
  }
  function prefillTask() {
    if (!state || state.phase !== "idle" || (state.focusTask && !state.taskAuto)) return false;
    var t = readerTitle();
    // a task this window filled in from a Reader that is gone is cleared; one the person typed stays
    if (!t) { if (!state.taskAuto || !state.focusTask) return false; state.focusTask = ""; state.taskAuto = false; persist(); return true; }
    if (t === state.focusTask) return false;
    state.focusTask = t; state.taskAuto = true; persist();
    return true;
  }

  /* ---------- the window ---------- */
  A.css("rdg-afterhours", [
    ".ah-win .win-body{background:var(--surface)}",
    ".ah-body{height:100%;overflow:auto;padding:16px 18px 18px;box-sizing:border-box;color:var(--ink);font:14px/20px var(--sans);user-select:text;-webkit-user-select:text}",
    ".ah-body *{box-sizing:border-box}",
    ".ah-scene{position:relative;overflow:hidden;isolation:isolate;border-radius:var(--r-m);background:linear-gradient(125deg,#182334,#273046 65%,#45404c);color:#fff2d6;padding:18px 20px;min-height:136px;display:flex;align-items:center;justify-content:space-between;border:1px solid #222937}",
    ".ah-scene:before{content:\"\";position:absolute;inset:0;z-index:-1;opacity:.42;background-image:radial-gradient(1px 1px at 18% 30%,white 75%,transparent),radial-gradient(1px 1px at 60% 14%,white 75%,transparent),radial-gradient(1px 1px at 75% 28%,white 75%,transparent),radial-gradient(1px 1px at 85% 62%,white 75%,transparent),radial-gradient(1px 1px at 34% 86%,white 75%,transparent);background-size:165px 105px}",
    ".ah-state{font:700 10.5px/14px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:#e4c99f}",
    ".ah-clock{font-size:56px;letter-spacing:-.06em;line-height:1.1;font-weight:500;font-variant-numeric:tabular-nums;margin-top:4px}",
    ".ah-moon{color:#e3bd85;opacity:.9;display:grid;place-items:center}",
    ".ah-line{margin:10px 0 12px;min-height:20px;color:var(--muted);font-size:13px}",
    ".ah-task{width:100%;margin:0 0 10px}",
    ".ah-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}",
    ".ah-row .slider{width:min(150px,40%)}",
    ".ah-seg[aria-disabled=true]{opacity:.5;pointer-events:none}",
    ".ah-lbl{font:700 10.5px/14px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}",
    ".ah-divider{height:1px;border:0;background:var(--line);margin:14px 0}",
    ".ah-meta{font-size:12px;line-height:17px;color:var(--muted);margin:10px 0 0}",
    ".ah-body h2{font:700 23px/1.05 var(--sans);letter-spacing:-.025em;margin:0 0 12px}",
    ".ah-sky{width:100%;display:block;aspect-ratio:2.6;border-radius:var(--r-m);background:linear-gradient(120deg,#192d41,#353146);margin:6px 0 10px}",
    ".ah-sky .ah-guide{fill:#fbefd9;opacity:.45}.ah-sky .ah-star{fill:#ffe2a0}.ah-sky .ah-path{stroke:#e4bb72;stroke-width:.5;fill:none;opacity:.85}",
    ".ah-rewards{padding-inline-start:19px;font-size:13px;line-height:18px;color:var(--muted);margin:12px 0 0}.ah-rewards li+li{margin-top:4px}.ah-rewards .ah-earned{color:var(--ink);font-weight:600}",
    ".ah-logs{list-style:none;padding:0;margin:12px 0}.ah-logs li{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--line)}",
    ".ah-logs li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ah-logs small{font:500 11px/20px var(--mono);color:var(--muted);flex:none}",
    "@media (max-width:500px){.ah-body{padding:12px}.ah-clock{font-size:44px}}"
  ].join("\n"));

  var win = null, body = null, seg = null, page = "focus";
  function syncWin() {
    if (!win || win.closing || !state) return;
    if (state.phase === "running") { if (win.state !== "reading") win.setState("reading"); }
    else if (win.state === "reading") win.setState(null);
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function btn(label, fn, o) { var b = A.ui.button(label, Object.assign({ onClick: fn }, o || {})); return b; }
  function svg(name, attrs) { var n = document.createElementNS("http://www.w3.org/2000/svg", name); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }

  function focusView(c) {
    prefillTask();
    var scene = el("div", "ah-scene"), left = el("div");
    var clockEl = el("div", "ah-clock", clock(timeLeft())); clockEl.setAttribute("role", "timer");
    left.appendChild(el("div", "ah-state", state.phase === "idle" ? T.free : state.phase === "paused" ? T.paused : T.working));
    left.appendChild(clockEl);
    var moon = el("span", "ah-moon"); moon.innerHTML = A.icon("moon", 46); moon.setAttribute("aria-hidden", "true");
    scene.appendChild(left); scene.appendChild(moon); c.appendChild(scene);
    var line = el("p", "ah-line"); line.setAttribute("aria-live", "polite"); line.textContent = lineText(); c.appendChild(line);

    var task = A.ui.field(state.focusTask || "", { cls: "ah-task", placeholder: T.task });
    task.setAttribute("aria-label", T.task); task.maxLength = 160; task.dataset.action = "task";
    task.addEventListener("input", function () { state.focusTask = task.value; state.taskAuto = false; persist(); });
    c.appendChild(task);

    var action = btn(state.phase === "running" ? T.pause : state.phase === "paused" ? T.resume : T.start, toggleFocus, { primary: true });
    action.dataset.action = "focus";
    var lengths = A.ui.segmented(LENGTHS.map(function (m) { return { value: String(m), label: String(m), title: m + " " + T.min }; }), String(state.duration), function (v) {
      if (state.phase !== "idle") { lengths.set(String(state.duration)); return; }
      state.duration = +v; persist(); paintClock();
    });
    lengths.classList.add("ah-seg"); lengths.setAttribute("aria-label", T.length + " (" + T.min + ")");
    if (state.phase !== "idle") lengths.setAttribute("aria-disabled", "true");
    var controls = el("div", "ah-row"); controls.appendChild(action); controls.appendChild(lengths); controls.appendChild(el("span", "ah-lbl", T.min));
    if (state.phase !== "idle") { var r = btn(T.reset, reset); r.dataset.action = "reset"; controls.appendChild(r); }
    c.appendChild(controls);
    c.appendChild(el("hr", "ah-divider"));

    var play = btn(loadingAudio ? T.wait : audio ? T.stop : T.play, toggleAudio); play.dataset.action = "sound";
    var vol = A.ui.slider(0, 1, 0.01, state.volume, function (v) { state.volume = v; try { if (window.AtlasSound) window.AtlasSound.setVolume(v); } catch (e) {} });
    vol.setAttribute("aria-label", T.volume); vol.addEventListener("change", persist);
    var music = el("div", "ah-row"); music.appendChild(play); music.appendChild(vol); c.appendChild(music);
    c.appendChild(el("p", "ah-meta", "Sessions are kept on this disk, in ~/Library/After Hours/state.json. Music is made in this page; nothing is streamed."));
  }
  function lineText() {
    if (state.phase === "running") { var d = new Date(state.deadline); return "Ends at " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ". A finished session adds a star."; }
    if (state.phase === "paused") return "Paused. Resume when you are ready.";
    return "A finished session adds one star to your chart.";
  }
  function starsView(c) {
    var n = state.stars.length;
    c.appendChild(el("h2", "", T.stars + " · " + n));
    var sky = svg("svg", { "class": "ah-sky", viewBox: "0 0 300 112", role: "img", "aria-label": T.stars + " · " + n });
    for (var i = 0; i < 61; i++) sky.appendChild(svg("circle", { "class": "ah-guide", cx: ((i * 73 + 13) % 298) + 1, cy: ((i * i * 29 + i * 3 + 7) % 108) + 2, r: i % 5 === 0 ? 0.65 : 0.4 }));
    var pos = state.stars.map(function (_, i) { return [18 + (i * 109) % 265, 16 + ((i * i * 23 + i * 43) % 80)]; });
    if (pos.length) sky.appendChild(svg("polyline", { "class": "ah-path", points: pos.map(function (p) { return p.join(","); }).join(" ") }));
    pos.forEach(function (p) { var x = p[0], y = p[1]; sky.appendChild(svg("path", { "class": "ah-star", d: "M" + x + " " + (y - 3.2) + "l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" })); });
    c.appendChild(sky);
    if (!n) c.appendChild(el("p", "ah-meta", T.empty));
    var ul = el("ul", "ah-rewards"); ul.setAttribute("aria-label", T.unlock);
    REWARDS.forEach(function (r) { ul.appendChild(el("li", n >= r[0] ? "ah-earned" : "", r[0] + " ✦ · " + r[1])); });
    c.appendChild(ul);
    if (!n) return;
    var log = el("ul", "ah-logs");
    state.stars.slice(-12).reverse().forEach(function (s) {
      var li = el("li"), when = "";
      try { when = new Date(s.at).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }); } catch (e) { when = ""; }
      li.appendChild(el("span", "", [when, s.task].filter(Boolean).join(" · ")));
      li.appendChild(el("small", "", (+s.minutes || 0) + " " + T.min));
      log.appendChild(li);
    });
    c.appendChild(log);
  }
  function render() {
    if (seg) seg.set(page);
    if (!body || !state) return;
    var ae = document.activeElement, keep = ae && body.contains(ae) ? ae.dataset && ae.dataset.action : null;
    var sel = keep === "task" ? [ae.selectionStart, ae.selectionEnd] : null;
    body.textContent = "";
    (page === "stars" ? starsView : focusView)(body);
    if (keep) {
      var b = body.querySelector('[data-action="' + keep + '"]');
      if (b) { try { b.focus({ preventScroll: true }); if (sel) b.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
    }
  }
  function paintClock() {
    if (!body || !state) return;
    var v = body.querySelector(".ah-clock"), text = clock(timeLeft());
    if (v && v.textContent !== text) v.textContent = text;
  }
  function go(section) { page = section === "stars" ? "stars" : "focus"; render(); }
  function launch(section) { A.apps.launch("afterhours", { section: section }); }

  function openWindow(app, o) {
    o = o || {}; load(); advance();
    if (o.section) page = o.section === "stars" ? "stars" : "focus";
    if (win && !win.closing) { win.focus(); render(); return win; }
    body = el("div", "ah-body");
    seg = A.ui.segmented([{ value: "focus", label: T.focus }, { value: "stars", label: "Stars" }], page, function (v) { go(v); });
    seg.setAttribute("aria-label", "After Hours");
    var w = win = A.wm.create({
      app: app, title: "After Hours", w: o.w || 380, h: o.h || 520, x: o.x, y: o.y, minW: 320, minH: 380, body: body, toolbar: seg, cls: "ah-win",
      onFocus: function (wn) { if (!wn.el.contains(document.activeElement)) { var b = body && body.querySelector('[data-action="focus"]'); if (b) try { b.focus({ preventScroll: true }); } catch (e) {} } },
      onClosed: function () { if (win === w) { win = null; body = null; seg = null; } }
    });
    syncWin(); render();
    return w;
  }

  /* ---------- the app ---------- */
  var app = A.apps.register({
    id: "afterhours", name: "After Hours", icon: "moon", accent: "#626c55", order: 42, cli: "afterhours", aliases: ["after hours"],
    desc: "A focus timer with lo-fi music. Each finished session adds a star.",
    quitWhenLastWindowCloses: true,
    launch: function (app, args) { openWindow(app, args || {}); },
    reopen: function (app, args) { if (!args || !args.section) return false; openWindow(app, args); },
    saveState: function () { return { section: page }; },
    restore: function (app, st, frame) { openWindow(app, { section: st && st.section, x: frame && frame.x, y: frame && frame.y, w: frame && frame.w, h: frame && frame.h }); },
    menus: function () {
      var s = load();
      return [
        { title: "View", items: [
          { label: "Focus", checked: page === "focus", cmd: "afterhours focus", run: function () { launch("focus"); } },
          { label: "Star chart", checked: page === "stars", cmd: "afterhours stars", run: function () { launch("stars"); } }] },
        { title: "Session", items: [
          { label: s.phase === "running" ? T.pause : s.phase === "paused" ? T.resume : T.start, cmd: s.phase === "running" ? "afterhours pause" : "afterhours start", run: toggleFocus },
          { label: T.reset, disabled: s.phase === "idle", cmd: "afterhours stop", run: reset }, "-",
          { label: loadingAudio ? T.wait : audio ? T.stop : T.play, run: function () { toggleAudio(); return false; } }] }
      ];
    }
  });

  // the shell command the menus show: afterhours [focus|stars|start|pause|stop|status]
  if (A.prog) A.prog("afterhours", "Apps", "A focus timer with lo-fi music", "afterhours [focus|stars|start|pause|stop|status]", function (p) {
    var sub = p.args[0] || "focus"; load(); advance();
    if (sub === "status") return p.out(JSON.stringify({ phase: state.phase, remaining_ms: timeLeft(), stars: state.stars.length }) + "\n").then(function () { return 0; });
    if (sub === "focus" || sub === "stars") { launch(sub); return 0; }
    if (sub === "start") { if (state.phase !== "running") toggleFocus(); return 0; }
    if (sub === "pause") { if (state.phase === "running") toggleFocus(); return 0; }
    if (sub === "stop") { if (state.phase !== "idle") reset(); return 0; }
    throw A.usageErr("unknown subcommand " + sub);
  });

  /* ---------- the clock keeps time with or without a window ---------- */
  function tick() { if (!state) return; if (advance()) render(); else paintClock(); }
  function ready() { load(); if (advance()) render(); }
  if (A.desktop && A.desktop.ready) ready(); else if (A.bus) A.bus.on("desktop:ready", ready);
  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
  // the front Reader's note fills an empty task while no session runs
  if (A.bus) ["win:focus", "win:title"].forEach(function (ev) {
    A.bus.on(ev, function (w) {
      if (!w || !w.app || w.app.id !== "reader" || !body || page !== "focus") return;
      if (prefillTask()) { var t = body.querySelector('[data-action="task"]'); if (t && document.activeElement !== t) t.value = state.focusTask; }
    });
  });
  A.afterHours = { open: launch, state: function () { return load() && JSON.parse(JSON.stringify(state)); } };
})(window.ATLAS = window.ATLAS || {});
