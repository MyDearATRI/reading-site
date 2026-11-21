/* Reading · 筆記頁的閱讀狀態（建置成 assets/status.js，只在筆記頁載入）

   標題下方一排：想讀、在讀、讀完。再按一次目前的狀態就清掉。
   和地圖（shelf.html）、今天、Reading OS 共用同一組資料：rdg-progress = {筆記 id: {s, at}}。
   設成「讀完」會排第一次重讀（明天），之後是 3、7、14、30 天（rdg-core.js）。
   「讀完」只表示讀過，不表示懂了（K5）。資料只存在這個瀏覽器。 */
(function () {
  "use strict";
  var id = document.body && document.body.getAttribute("data-note");
  var h1 = document.querySelector("main article h1");
  if (!id || !h1 || !window.RDG) return;

  var STATES = [["todo", "想讀"], ["reading", "在讀"], ["done", "讀完"]];
  var bar = document.createElement("div");
  bar.className = "status-bar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "閱讀狀態");
  bar.innerHTML = STATES.map(function (s) { return '<button type="button" data-s="' + s[0] + '" aria-pressed="false">' + s[1] + "</button>"; }).join("") +
    '<span class="status-note" aria-live="polite"></span>';

  // 放在深度切換（depth.js 插在標題後）之後；沒有深度切換時就放在標題後
  var after = h1.nextElementSibling && h1.nextElementSibling.classList.contains("depth") ? h1.nextElementSibling : h1;
  after.parentNode.insertBefore(bar, after.nextSibling);
  var note = bar.querySelector(".status-note");

  function paint() {
    var s = RDG.status(id);
    Array.prototype.forEach.call(bar.querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-s") === s)); });
  }
  bar.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button[data-s]");
    if (!b) return;
    var s = b.getAttribute("data-s"), prog = RDG.progress(), cur = RDG.status(id, prog);
    if (cur === s) { delete prog[id]; note.textContent = ""; }
    else {
      prog[id] = { s: s, at: new Date().toISOString() };
      if (s === "done") note.textContent = RDG.scheduleReread(id) ? "明天會出現在「今天」的重讀清單" : "";
      else note.textContent = "";
    }
    RDG.ls.set("rdg-progress", prog);
    paint();
  });
  RDG.onChange(function (key) { if (key === "rdg-progress" || key == null) paint(); });
  paint();
})();
