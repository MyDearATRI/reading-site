/* Reading · 今天的個人部分（建置成 assets/today.js，只在首頁載入）

   首頁的日報由建置時產生；這裡只補上存在這個瀏覽器裡的東西：
   - 該重讀了：設成「讀完」的筆記，依 1、3、7、14、30 天的節奏回來（rdg-core.js 的重讀時鐘）
   - 正在讀：設成「在讀」的筆記，最近設的在前
   沒有任何一項時整區不顯示。不寫晚了幾天，也不計連續天數（K1）。 */
(function () {
  "use strict";
  var box = document.getElementById("today-me");
  if (!box || !window.RDG) return;
  var root = (document.body && document.body.getAttribute("data-root")) || "";
  var byId = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function render() {
    if (!byId) return;
    var items = RDG.todayItems(byId, { daily: null });
    var rr = items.filter(function (x) { return x.k === "reread"; }), cont = items.filter(function (x) { return x.k === "cont"; });
    if (!rr.length && !cont.length) { box.hidden = true; box.innerHTML = ""; return; }
    var row = function (x, btn) {
      return '<li><a href="' + esc(root + x.n.h) + '">' + esc(x.n.t) + '</a><span class="rs">' + esc(x.n.f) + "</span>" +
        (btn ? '<button type="button" class="rr-done" data-id="' + esc(x.id) + '">重讀完了</button>' : "") + "</li>";
    };
    var h = "";
    if (rr.length) h += '<div class="tm"><h2>該重讀了</h2><ul>' + rr.map(function (x) { return row(x, true); }).join("") + "</ul></div>";
    if (cont.length) h += '<div class="tm"><h2>正在讀</h2><ul>' + cont.map(function (x) { return row(x, false); }).join("") + "</ul></div>";
    box.innerHTML = h;
    box.hidden = false;
  }

  box.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".rr-done");
    if (!b) return;
    var res = RDG.rereadDone(b.getAttribute("data-id"));
    var li = b.closest("li");
    if (res && li) {
      var note = document.createElement("span");
      note.className = "rs done";
      note.textContent = res.complete ? "這篇的重讀都完成了" : "下次在 " + res.nextDays + " 天後";
      b.replaceWith(note);
      setTimeout(render, 1600);
    } else render();
  });

  fetch(root + "catalog.json").then(function (r) { return r.json(); }).then(function (j) {
    byId = {};
    (j.notes || []).forEach(function (n) { byId[n.id] = n; });
    render();
    RDG.onChange(function (key) { if (key === "rdg-progress" || key === "rdg-reread" || key == null) render(); });
  }).catch(function () { /* offline or blocked: the daily report above still works */ });
})();
