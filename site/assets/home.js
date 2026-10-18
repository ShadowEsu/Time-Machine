/* Time Machine home page: reveals that play once, and the Ladder fader.
   The device in the hero lives in assets/device.js. No scroll handler and no per frame work at rest.
   Pricing is planned. Nothing is for sale yet. See docs/adr/0002-pricing-ladder.md. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- reveals: once, at 15 percent into view. Transform and opacity only. ---------- */
  const els = $$(".rv, .vs, [data-stagger]");
  if (RM || !("IntersectionObserver" in window)) els.forEach((e) => e.classList.add("in"));
  else {
    const io = new IntersectionObserver((list) => list.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      e.target.classList.add("in");
    }), { threshold: 0.15 });
    els.forEach((e) => io.observe(e));
  }

  /* ---------- The Ladder: drag the fader, tap the track, or use the arrow keys ---------- */
  const thumb = $("#ldThumb");
  if (!thumb) return;
  const track = $(".ld-track"), dig = $("#ldDig"), stepEl = $("#ldStep"), mnEl = $("#ldMn");
  const puck = $(".ld-puck"), inkOuter = $(".ld-ink"), inkInner = $(".ld-ink-in"), graph = $(".ld-graph");
  const STEPS = [[1, 9, "Start"], [7, 8, "Step 2 · month 7"], [13, 7, "Step 3 · month 13"], [25, 6, "Floor · month 25"]];
  const Y = [20, 73, 126, 180];
  const pad = (n) => String(n).padStart(2, "0");
  let month = 1, trackW = 0, graphW = 0, graphH = 0;

  function draw() {
    const f = (month - 1) / 29;
    let st = 0; STEPS.forEach((s, i) => { if (month >= s[0]) st = i; });
    dig.style.transform = `translate3d(0,${-25 * st}%,0)`;
    stepEl.textContent = STEPS[st][2]; mnEl.textContent = pad(month);
    thumb.style.transform = `translate3d(${(f * trackW).toFixed(1)}px,0,0)`;
    thumb.setAttribute("aria-valuenow", String(month));
    thumb.setAttribute("aria-valuetext", `Month ${month}, $${STEPS[st][1]} a month. Planned.`);
    inkOuter.style.transform = `translate3d(${(-(1 - f) * graphW).toFixed(1)}px,0,0)`;
    inkInner.style.transform = `translate3d(${((1 - f) * graphW).toFixed(1)}px,0,0)`;
    puck.style.transform = `translate3d(${(f * graphW).toFixed(1)}px,${((Y[st] / 200) * graphH).toFixed(1)}px,0)`;
  }
  // Sizes come from ResizeObservers, so drawing never forces a layout read.
  new ResizeObserver((es) => { trackW = es[0].contentRect.width; draw(); }).observe(track);
  new ResizeObserver((es) => { graphW = es[0].contentRect.width; graphH = es[0].contentRect.height; draw(); }).observe(graph);

  const set = (m) => { m = clamp(Math.round(m), 1, 30); if (m !== month) { month = m; draw(); } };
  let box = null, dragging = false;
  const fromX = (x) => 1 + 29 * clamp((x - box.left) / box.width, 0, 1);
  thumb.addEventListener("pointerdown", (e) => { dragging = true; box = track.getBoundingClientRect(); thumb.setPointerCapture(e.pointerId); e.preventDefault(); });
  thumb.addEventListener("pointermove", (e) => { if (dragging) set(fromX(e.clientX)); });
  const end = () => { dragging = false; };
  thumb.addEventListener("pointerup", end); thumb.addEventListener("pointercancel", end);
  track.addEventListener("pointerdown", (e) => { box = track.getBoundingClientRect(); set(fromX(e.clientX)); });
  thumb.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -6, PageUp: 6 }[e.key];
    if (d) set(month + d); else if (e.key === "Home") set(1); else if (e.key === "End") set(30); else return;
    e.preventDefault();
  });
  draw();
})();
