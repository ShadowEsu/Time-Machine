// Provider marks need each provider's permission before public use (see assets/agents/SOURCES.md).
// They show only on a private local preview: localhost plus ?brand-preview=1. The SVGs are git-ignored.
(function () {
  var host = location.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return;
  if (new URLSearchParams(location.search).get("brand-preview") !== "1") return;
  var list = document.querySelector(".agent-support");
  if (!list) return;
  list.classList.add("with-marks");
  list.querySelectorAll("li[data-mark]").forEach(function (li) {
    var box = document.createElement("span");
    box.className = "agent-mark";
    var img = document.createElement("img");
    img.src = "assets/agents/" + li.dataset.mark + ".svg";
    img.width = 24;
    img.height = 24;
    img.alt = "";
    img.decoding = "async";
    img.onerror = function () { box.remove(); };
    box.appendChild(img);
    li.prepend(box);
  });
})();
