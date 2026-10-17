/* Time Machine inner pages: scroll reveals, count ups, reading progress and the small instruments.
   No network requests. Every instrument is a progressive enhancement: without this file the
   pages show the same facts as plain text. Honors prefers-reduced-motion. */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- count ups ---------- */
  function countUp(el) {
    var to = parseInt(el.getAttribute("data-count"), 10);
    if (reduce || !to) { el.textContent = String(to); return; }
    var t0 = 0;
    var dur = 1100;
    function frame(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(to * e));
      if (k < 1) requestAnimationFrame(frame);
    }
    el.textContent = "0";
    requestAnimationFrame(frame);
  }

  /* ---------- reveals ---------- */
  function revealed(el) {
    el.classList.add("in");
    $$("[data-count]", el).forEach(countUp);
  }
  var rv = $$(".rv");
  if (reduce || !("IntersectionObserver" in window)) {
    rv.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { revealed(e.target); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
    rv.forEach(function (el) { io.observe(el); });
  }

  /* ---------- steppers: the loop, the exit codes and the gates ---------- */
  $$("[data-stepper]").forEach(function (root) {
    var keys = $$("[data-step]", root);
    var panes = $$("[data-pane]", root);
    var knob = root.querySelector("[data-knob]");
    var rot = root.querySelector(".knob-rot");
    var led = root.querySelector(".led");
    var angles = (root.getAttribute("data-angles") || "").split(",").map(Number);
    var rows = root.getAttribute("data-rows") ? $$(root.getAttribute("data-rows")) : [];
    var cur = 0;

    function go(i, focus) {
      cur = (i + keys.length) % keys.length;
      keys.forEach(function (k, j) { k.setAttribute("aria-pressed", j === cur ? "true" : "false"); });
      panes.forEach(function (p, j) { p.hidden = j !== cur; });
      rows.forEach(function (r, j) { r.classList.toggle("on", j === cur); });
      if (rot && angles.length) rot.style.setProperty("--a", angles[cur] + "deg");
      if (led) led.setAttribute("data-v", keys[cur].getAttribute("data-v") || "");
      if (knob) knob.setAttribute("aria-label", "Next step. Now showing step " + (cur + 1) + " of " + keys.length + ".");
      if (focus) keys[cur].focus();
    }
    keys.forEach(function (k, j) {
      k.addEventListener("click", function () { go(j); });
      k.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); go(cur + 1, true); }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); go(cur - 1, true); }
      });
    });
    if (knob) knob.addEventListener("click", function () { go(cur + 1); });
    rows.forEach(function (r, j) {
      r.addEventListener("click", function () { go(j); });
    });
    var start = keys.findIndex(function (k) { return k.getAttribute("aria-pressed") === "true"; });
    go(start < 0 ? 0 : start);
  });

  /* ---------- the network switchboard ---------- */
  $$("[data-switchboard]").forEach(function (root) {
    var net = root.querySelector('[data-sw="deny"]');
    var box = root.querySelector('[data-sw="sandbox"]');
    var led = root.querySelector(".led");
    var panes = $$("[data-pane]", root);
    function sync() {
      var deny = net.getAttribute("aria-checked") === "true";
      var sandbox = box.getAttribute("aria-checked") === "true";
      var state = !deny ? "allow" : (sandbox ? "off" : "blocked");
      box.setAttribute("aria-disabled", deny ? "false" : "true");
      panes.forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== state; });
      led.setAttribute("data-v", state === "blocked" ? "" : "works");
    }
    [net, box].forEach(function (b) {
      b.addEventListener("click", function () {
        b.setAttribute("aria-checked", b.getAttribute("aria-checked") === "true" ? "false" : "true");
        sync();
      });
    });
    sync();
  });

  /* ---------- gentle tilt toward the pointer: fine pointer only, never on weak devices ---------- */
  var weak = document.documentElement.getAttribute("data-tier") === "low";
  if (!reduce && !weak && window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 961px)").matches) {
    $$(".mod.tilt").forEach(function (mod) {
      var zone = mod.closest(".hero") || mod.parentElement;
      var raf = 0, box = null;
      zone.addEventListener("pointerenter", function () { box = null; });
      window.addEventListener("scroll", function () { box = null; }, { passive: true });
      zone.addEventListener("pointermove", function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          if (!box) box = zone.getBoundingClientRect();
          var x = (e.clientX - box.left) / box.width - 0.5;
          var y = (e.clientY - box.top) / box.height - 0.5;
          mod.style.setProperty("--ry", (-11 + x * 8).toFixed(2) + "deg");
          mod.style.setProperty("--rx", (9 - y * 6).toFixed(2) + "deg");
        });
      });
      zone.addEventListener("pointerleave", function () {
        mod.style.removeProperty("--ry");
        mod.style.removeProperty("--rx");
      });
    });
  }

  /* ---------- reading progress on blog posts ---------- */
  var body = document.querySelector(".post-b");
  if (body) {
    var bar = document.querySelector(".top-progress i");
    var rail = document.querySelector(".rail");
    var label = document.querySelector(".rail-h span");
    var ticking = false;
    var update = function () {
      ticking = false;
      var r = body.getBoundingClientRect();
      var span = r.height - window.innerHeight * 0.6;
      var p = Math.max(0, Math.min(1, (window.innerHeight * 0.3 - r.top) / Math.max(1, span)));
      if (bar) bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
      if (rail) rail.style.setProperty("--p", p.toFixed(4));
      if (label) label.textContent = String(Math.round(p * 100)).padStart(3, "0") + "%";
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }
})();
