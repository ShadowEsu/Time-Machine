/* Opening screen and fade-ins.
   Opening: black stage, the wordmark, a loading bar at the bottom. First page load of a visit only.
   The bar completes when the page and its fonts are ready, and the screen leaves then
   (at least 900 ms, so it never flashes). Any click or key skips it. Reduced motion or no
   JavaScript: no opening at all. Loaded in <head> without defer so it can decide before paint. */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen = false;
  try { seen = sessionStorage.getItem("tm-intro") === "1"; sessionStorage.setItem("tm-intro", "1"); } catch (e) { /* Storage is optional. */ }
  if (!reduced && !seen) root.setAttribute("data-intro", "play");

  var started = Date.now();
  function finish() {
    if (root.getAttribute("data-intro") !== "play") return;
    root.setAttribute("data-intro", "leave");
    setTimeout(function () { root.removeAttribute("data-intro"); }, 520);
  }
  function whenLoaded() {
    root.setAttribute("data-loaded", "");
    setTimeout(finish, Math.max(0, 900 - (Date.now() - started)));
  }
  if (root.getAttribute("data-intro") === "play") {
    // Ready means the page is parsed and its fonts are in, so the first screen renders right.
    // Screenshots further down the page keep loading behind it.
    document.addEventListener("DOMContentLoaded", function () {
      (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(whenLoaded, whenLoaded);
    });
    addEventListener("keydown", finish, { once: true });
    addEventListener("pointerdown", finish, { once: true });
    // Never hold the page hostage to a slow connection.
    setTimeout(finish, 2500);
  }

  // Fade-ins: elements marked data-reveal rise in once when they enter the screen.
  document.addEventListener("DOMContentLoaded", function () {
    var items = document.querySelectorAll("[data-reveal]");
    if (reduced || !("IntersectionObserver" in window)) {
      for (var i = 0; i < items.length; i++) items[i].classList.add("in");
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].isIntersecting) { entries[j].target.classList.add("in"); io.unobserve(entries[j].target); }
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    for (var k = 0; k < items.length; k++) io.observe(items[k]);
  });
})();
