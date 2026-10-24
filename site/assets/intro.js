/* Home intro: the big wordmark at the bottom of the screen counts 0 % to 100 % while the page really loads
   (web fonts, the hero poster, the load event; the 3D machine is not waited for), then wipes up and is removed.
   Loaded parser-blocking as the first thing in <body>, so the overlay paints in the first frame. The hero stays
   rendered, opaque and in the accessibility tree underneath. Nothing is in the HTML. It runs only under S5's
   html.motion switch (set before paint by the head script: no reduced motion, no weak device), once per tab
   session, and not while "Pause motion" is on; otherwise there is no overlay at all. A CSS failsafe (home-s5.css)
   clears it if this script dies. */
(() => {
  "use strict";
  const body = document.body, root = document.documentElement;
  // The stored "Pause motion" choice (sound.js owns the button) applies before machine.js and the first paint.
  try { if (localStorage.getItem("tm-motion") === "paused") root.classList.add("motion-paused"); } catch (_) {}
  // Run fn once the page has loaded, so nothing it fetches competes with the first paint.
  const afterLoad = (fn) => { if (document.readyState === "complete") setTimeout(fn, 0); else addEventListener("load", () => setTimeout(fn, 0), { once: true }); };
  // The corner dock (Pause motion, music) is sound.js, fetched after the page has loaded.
  afterLoad(() => { const s = document.createElement("script"); s.src = "assets/sound.js"; document.body.append(s); });
  if (!body || !root.classList.contains("motion") || root.classList.contains("motion-paused") || !window.matchMedia ||
    !matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
  try {
    if (sessionStorage.getItem("tm-intro") === "1") return;
    sessionStorage.setItem("tm-intro", "1");
  } catch (_) { return; }

  const MIN = 1200, FORCE = 2400, HOLD = 120, IDS = ["cp-0001", "cp-0002", "cp-0003", "cp-0004", "cp-0005", "cp-0006"];
  const el = document.createElement("section");
  el.className = "tmi";
  el.setAttribute("aria-label", "Intro");
  // The wordmark is one block of plain text (no per-letter boxes), so it paints as a single, largest element.
  el.innerHTML =
    '<div class="tmi-bar">' +
      '<button type="button" class="tmi-btn tmi-btn-sound" data-intro-sound hidden>Enter with sound</button>' +
      '<button type="button" class="tmi-btn" data-intro-skip>Skip intro</button>' +
    "</div>" +
    '<div class="tmi-art" aria-hidden="true">' +
      '<div class="tmi-meta"><span class="tmi-k">save point</span><span class="tmi-id">cp-0001</span></div>' +
      '<div class="tmi-rule"><i></i></div>' +
      '<div class="tmi-mark">' +
        '<p class="tmi-word" translate="no">Time<br><em>Machine</em></p>' +
        '<span class="tmi-n"><b>0</b>%</span>' +
      "</div>" +
    "</div>";
  body.prepend(el);

  const num = el.querySelector(".tmi-n b"), rule = el.querySelector(".tmi-rule i"), id = el.querySelector(".tmi-id");
  const t0 = performance.now();
  let done = 0, last = t0, shown = 0, raf = 0, flick = 0, idAt = 0, gone = false, prev = t0;
  const TASKS = 3;
  const finish = () => { done++; last = performance.now(); };

  // Real loading: the web fonts the first layout asked for (document.fonts.ready, checked after that layout), the
  // load event, then the hero's poster (the same URL load.js draws, so it is fetched once). The poster is asked for
  // only after the load event, so it never competes with the first paint.
  const fontsReady = () => { if (document.fonts) document.fonts.ready.then(finish, finish); else finish(); };
  afterLoad(() => {
    finish();
    const poster = new Image();
    poster.onload = poster.onerror = finish;
    poster.src = matchMedia("(max-width: 640px)").matches ? "assets/img/s5/stack-390-poster.webp" : "assets/img/s5/stack-1440-poster.webp";
  });

  const ease = (x) => 1 - Math.pow(1 - x, 3);
  function frame(now) {
    const t = now - t0;
    // Done tasks count fully; the one in flight creeps up to 80 % of its share, so the number never sits still.
    let target = t >= FORCE ? 1 : (done + (done < TASKS ? .8 * (1 - Math.exp(-(now - last) / 500)) : 0)) / TASKS;
    const goal = Math.min(target, ease(Math.min(1, t / MIN)));
    // Time-based easing (not a fixed share per frame), so a busy main thread (the 3D machine compiling on a slow
    // phone) slows the frames, not the count.
    shown += Math.max(0, goal - shown) * (1 - Math.exp(-(now - prev) / 70));
    prev = now;
    if (goal >= 1 && shown > .996) shown = 1;
    num.textContent = String(Math.round(shown * 100));
    rule.style.transform = `scaleX(${shown})`;
    if (now - idAt > 150) {
      idAt = now;
      id.textContent = IDS[++flick % IDS.length];
      if (id.animate) id.animate([{ transform: "translateY(55%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 140, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    if (shown >= 1) { id.textContent = "cp-0006"; setTimeout(leave, HOLD); return; }
    raf = requestAnimationFrame(frame);
  }
  // The counter starts on the second frame, so the first frame (the page and the wordmark) paints with no extra
  // work; by then that frame's layout has asked for its fonts, so document.fonts.ready waits for them.
  raf = requestAnimationFrame(() => { raf = requestAnimationFrame((now) => { prev = now; fontsReady(); frame(now); }); });
  // Hard cap: whatever the frame rate, the intro is gone by ~3 s.
  setTimeout(() => { if (!gone) { num.textContent = "100"; rule.style.transform = "scaleX(1)"; leave(); } }, FORCE + 400);

  function remove() {
    if (!el.isConnected) return;
    const inside = el.contains(document.activeElement);
    el.remove();
    removeEventListener("keydown", onKey, true);
    removeEventListener("pointerdown", onPointer, true);
    removeEventListener("wheel", skip, { passive: true });
    removeEventListener("touchmove", skip, { passive: true });
    document.removeEventListener("focusin", onFocus);
    if (inside) { const main = document.getElementById("main"); if (main) main.focus({ preventScroll: true }); }
  }
  function leave(fast) {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(raf);
    el.classList.add(fast ? "tmi-out-fast" : "tmi-out");
    el.addEventListener("transitionend", (e) => { if (e.target === el) remove(); });
    setTimeout(remove, fast ? 600 : 800);
  }
  function skip() { leave(true); }
  // Any key ends it at once, except Tab (to reach the two buttons) and bare modifiers.
  function onKey(e) {
    if (e.key === "Tab" || e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    if (e.key === "Escape") e.preventDefault();
    skip();
  }
  // Any click or tap ends it, except on its own buttons (their click events do).
  function onPointer(e) { if (!(e.target instanceof Element && e.target.closest(".tmi-btn"))) skip(); }
  // Focus is never trapped: tabbing past the buttons into the page reveals it.
  function onFocus(e) { if (!el.contains(e.target)) skip(); }
  addEventListener("keydown", onKey, true);
  addEventListener("pointerdown", onPointer, true);
  addEventListener("wheel", skip, { passive: true });
  addEventListener("touchmove", skip, { passive: true });
  document.addEventListener("focusin", onFocus);
  el.querySelector("[data-intro-skip]").addEventListener("click", skip);
  el.querySelector("[data-intro-sound]").addEventListener("click", skip);
})();
