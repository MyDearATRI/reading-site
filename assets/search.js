/* Reading · 全站搜尋（建置成 assets/search.js，每一頁都載入）

   打開方式：⌘K（Mac）或 Ctrl-K、按 /、或按頁首的「搜尋」。
   目錄 catalog.json 第一次打開時才載入，之後留在記憶體裡。
   比對標題、主題、所屬資料夾與一句話摘要；計劃章節排在寫好的筆記之後，並標「計劃」。
   在 Reading OS 的 Reader 視窗裡（html.rdg-embedded）不接 ⌘K，交給 OS 的 Spotlight。
   window.RDGSearch = { open(q), close() } */
(function () {
  "use strict";
  if (window.RDGSearch) return;

  var root = (document.body && document.body.getAttribute("data-root")) || "";
  var IS_APPLE = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  var cat = null, loading = null, ov = null, input = null, list = null, hint = null, hits = [], sel = 0;

  function load() {
    if (cat) return Promise.resolve(cat);
    if (!loading) {
      loading = fetch(root + "catalog.json").then(function (r) { return r.json(); })
        .then(function (j) { cat = (j && j.notes) || []; return cat; })
        .catch(function () { loading = null; cat = null; return []; });
    }
    return loading;
  }
  function norm(s) { return String(s || "").normalize("NFKC").toLowerCase(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function score(n, terms) {
    var t = n._t || (n._t = norm(n.t)), k = n._k || (n._k = norm((n.k || []).join(" "))),
        f = n._f || (n._f = norm(n.f)), s = n._s || (n._s = norm(n.s));
    var sc = 0;
    for (var i = 0; i < terms.length; i++) {
      var q = terms[i], at = t.indexOf(q);
      if (at === 0) sc += 14;
      else if (at > 0) sc += 9;
      else if (k.indexOf(q) >= 0) sc += 5;
      else if (f.indexOf(q) >= 0) sc += 3;
      else if (s.indexOf(q) >= 0) sc += 2;
      else return 0;
    }
    return n.p ? sc - 3 : sc;
  }

  function build() {
    ov = document.createElement("div");
    ov.className = "search-ov"; ov.hidden = true;
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "搜尋筆記");
    ov.innerHTML = '<div class="search-box"><input type="search" placeholder="搜尋筆記、領域、主題" aria-label="搜尋" autocomplete="off">' +
      '<ul class="search-list" role="listbox"></ul><p class="search-hint"></p></div>';
    document.body.appendChild(ov);
    input = ov.querySelector("input"); list = ov.querySelector(".search-list"); hint = ov.querySelector(".search-hint");
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    input.addEventListener("input", run);
    input.addEventListener("keydown", function (e) {
      if (e.isComposing) return;
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); go(hits[sel]); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    list.addEventListener("click", function (e) {
      var li = e.target.closest("li[data-i]"); if (li) go(hits[+li.getAttribute("data-i")]);
    });
  }

  function run() {
    var q = norm(input.value).trim();
    if (!q) { hits = []; list.innerHTML = ""; hint.textContent = "輸入標題、領域或概念，例如「最優傳輸」或「Ricci」。"; return; }
    load().then(function (notes) {
      if (norm(input.value).trim() !== q) return;
      var terms = q.split(/\s+/).filter(Boolean);
      hits = notes.map(function (n) { return { n: n, sc: score(n, terms) }; })
        .filter(function (x) { return x.sc > 0; })
        .sort(function (a, b) { return b.sc - a.sc; }).slice(0, 30).map(function (x) { return x.n; });
      sel = 0;
      list.innerHTML = hits.map(function (n, i) {
        return '<li role="option" data-i="' + i + '"' + (i === 0 ? ' aria-selected="true"' : "") + '>' +
          '<span class="st">' + esc(n.t) + (n.p ? '<span class="tag-plan">計劃</span>' : "") + "</span>" +
          '<span class="sf">' + esc(n.f) + "</span>" + (n.s ? '<span class="ss">' + esc(n.s) + "</span>" : "") + "</li>";
      }).join("");
      hint.textContent = hits.length ? "↑↓ 選擇，Enter 打開，Esc 關閉" : "沒有找到。換個詞，或少打幾個字。";
    });
  }
  function move(d) {
    if (!hits.length) return;
    sel = (sel + d + hits.length) % hits.length;
    Array.prototype.forEach.call(list.children, function (li, i) { li.setAttribute("aria-selected", String(i === sel)); });
    var cur = list.children[sel]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  }
  function go(n) { if (n) location.href = root + n.h; }

  function open(q) {
    if (!ov) build();
    ov.hidden = false;
    document.documentElement.classList.add("search-open");
    input.value = q || ""; run(); input.focus(); input.select();
    load();
  }
  function close() {
    if (!ov || ov.hidden) return;
    ov.hidden = true;
    document.documentElement.classList.remove("search-open");
  }

  function editable(t) {
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }
  window.addEventListener("keydown", function (e) {
    if (document.documentElement.classList.contains("rdg-embedded")) return;   // the OS Spotlight takes it
    var cmdK = (IS_APPLE ? e.metaKey : e.ctrlKey) && !e.altKey && (e.code === "KeyK" || (e.key && e.key.toLowerCase() === "k"));
    if (cmdK || (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target))) {
      e.preventDefault(); open("");
    }
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-search]");
    if (b) { e.preventDefault(); open(""); }
  });
  // the header button shows the shortcut this computer uses
  if (!IS_APPLE) Array.prototype.forEach.call(document.querySelectorAll(".search-btn kbd"), function (k) { k.textContent = "Ctrl K"; });

  window.RDGSearch = { open: open, close: close };
})();
