/* The blueprint sheets on home. The markup is each drawing's final, exploded state, which is what no-JS and
   reduced-motion visitors see. Here, each sheet assembles as it enters the screen and pulls apart as you scroll:
   [data-from="dx dy"]  a part starts offset by (dx, dy) in drawing units and slides home;
   .draw               a line draws itself (pathLength="1"); its arrowhead appears when the line arrives;
   .reveal             a dashed line fades in over the same stretch;
   [data-at=".6"]      a part or a numbered balloon appears once the sheet's progress passes .6.
   Nothing runs while no sheet is on screen. */
(function () {
  "use strict";
  var band = document.querySelector(".bp");
  if (!band || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var sheets = Array.prototype.slice.call(band.querySelectorAll("[data-sheet]"));
  if (!sheets.length) return;

  function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  var items = sheets.map(function (s) {
    return {
      el: s,
      moves: all(s, "[data-from]").map(function (g) {
        var v = g.getAttribute("data-from").split(/\s+/).map(Number);
        return { g: g, dx: v[0] || 0, dy: v[1] || 0 };
      }),
      draws: all(s, ".draw").map(function (p) { return { p: p, marker: p.getAttribute("marker-end") }; }),
      reveals: all(s, ".reveal"),
      ats: all(s, "[data-at]").map(function (e) { return { e: e, at: Number(e.getAttribute("data-at")) }; }),
      p: -1,
      on: false
    };
  });

  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function apply(it, p) {
    if (Math.abs(p - it.p) < 0.002) return;
    it.p = p;
    var k = 1 - ease(clamp(p / 0.8));
    it.moves.forEach(function (m) {
      if (k < 0.001) m.g.removeAttribute("transform");
      else m.g.setAttribute("transform", "translate(" + (m.dx * k).toFixed(1) + " " + (m.dy * k).toFixed(1) + ")");
    });
    var d = clamp((p - 0.2) / 0.55);
    it.draws.forEach(function (x) {
      x.p.style.strokeDashoffset = (1 - d).toFixed(3);
      if (x.marker) { if (d > 0.97) x.p.setAttribute("marker-end", x.marker); else x.p.removeAttribute("marker-end"); }
    });
    it.reveals.forEach(function (r) { r.style.opacity = d.toFixed(2); });
    it.ats.forEach(function (a) { a.e.classList.toggle("on", p >= a.at); });
  }

  // 0 when the sheet's top is near the bottom of the screen, 1 once its top has risen past a third of it.
  function progress(el) {
    var r = el.getBoundingClientRect(), vh = window.innerHeight || 800;
    return clamp((vh * 0.92 - r.top) / (vh * 0.6));
  }

  var queued = false;
  function update() {
    queued = false;
    items.forEach(function (it) { if (it.on) apply(it, progress(it.el)); });
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }

  band.classList.add("live");
  items.forEach(function (it) { apply(it, progress(it.el)); });

  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var it = items[sheets.indexOf(e.target)];
        if (!it) return;
        it.on = e.isIntersecting;
        if (!it.on) apply(it, progress(it.el)); // settle at 0 or 1 when it leaves
      });
      queue();
    }, { rootMargin: "10% 0px 10% 0px" });
    sheets.forEach(function (s) { io.observe(s); });
  } else {
    items.forEach(function (it) { it.on = true; });
  }
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
})();
