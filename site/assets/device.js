/* The Time Machine device in the home page hero.
   The same save points, dial detents and recorded verdicts as the story page (assets/story.js).
   Power on plays once. The pointer tilt and sheen run only on a fine pointer, only while the pointer moves,
   and only while the device is on screen. Weak devices (data-tier="low") get a shorter power on and no tilt.
   Story data is the synthetic Marigold Tips demo. IDs and verdicts match a real `tm demo` run.
   Pressing Check replays the recorded verdict. Nothing runs in your browser. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const root = document.documentElement;
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
  let LITE = root.dataset.tier === "low";

  const rig = $("#rig"), dev = $("#dev"), knob = $("#knob"), knobRot = $("#knobRot"), led = $("#led");
  if (!rig) return;
  const D = { mode: $("#dMode"), clock: $("#dClock"), id: $("#dId"), note: $("#dNote"), stat: $("#dStat"), head: $("#dHead") };
  const dots = $$("#dLine i");
  const outs = $$("[data-dev-out]");
  const keys = {}; $$(".key", rig).forEach((k) => (keys[k.dataset.k] = k));

  const CPS = [
    { id: "cp-0001", t: "10:05:00", note: "Initial tip calculator", v: "works" },
    { id: "cp-0002", t: "10:20:00", note: "Added split bill", v: "works" },
    { id: "cp-0003", t: "10:42:07", note: "Added dark mode", v: "works" },
    { id: "cp-0004", t: "10:51:00", note: "Agent: fixed lint warnings", v: "broken" },
    { id: "cp-0005", t: "11:04:00", note: "Changed currency", v: "broken" },
    { id: "cp-0006", t: "11:12:00", note: "Added a dependency", v: "broken" },
  ];
  const DET = (i) => -135 + i * 54;
  let sel = 5, checked = {}, checking = -1, flash = null, flashT = 0, angle = null, on = RM;
  const cue = kind => window.TMSound?.cue(kind);
  let filmTimers = [];
  function stopFilm() { filmTimers.forEach(clearTimeout); filmTimers = []; dev.classList.remove("glitch"); dev.dataset.scene = "idle"; }
  function film() {
    finishIntro(); stopFilm(); clearTimeout(flashT); flash = null; checking = -1; sel = 5;
    checked[CPS[5].id] = "broken"; dev.dataset.scene = "break"; render(); cue("failure");
    if (RM) {
      sel = 2; checked[CPS[2].id] = "works"; dev.dataset.scene = "working"; render(); return;
    }
    dev.classList.add("glitch");
    const later = (ms, fn) => filmTimers.push(setTimeout(fn, ms));
    later(600, () => dev.classList.remove("glitch"));
    later(900, () => { dev.dataset.scene = "rewind"; render(); cue("rewind"); });
    [4, 3, 2].forEach((i, step) => later(1100 + step * 400, () => { sel = i; checked[CPS[i].id] = CPS[i].v; render(); cue("detent"); }));
    later(2300, () => { dev.dataset.scene = "working"; render(); cue("success"); });
  }

  /* ---------- the screen ---------- */
  function render() {
    const c = CPS[sel], v = checked[c.id];
    let s = { mode: "saved", clock: c.t, id: c.id, note: c.note, stat: v || "not checked yet", sc: v || "" };
    if (dev.dataset.scene === "rewind") s.mode = "rewinding";
    if (checking === sel) s = Object.assign(s, { mode: "checking", stat: "checking · network off", sc: "" });
    if (flash) s = Object.assign(s, flash);
    D.mode.textContent = s.mode; D.clock.textContent = s.clock; D.id.textContent = s.id; D.note.textContent = s.note; D.stat.textContent = s.stat;
    D.stat.className = "scr-stat " + s.sc;
    dots.forEach((el, i) => {
      const dv = checked[CPS[i].id];
      el.classList.toggle("on", on);
      el.classList.toggle("works", dv === "works");
      el.classList.toggle("broken", dv === "broken");
    });
    D.head.style.transform = `translateX(${(sel * 0.2 * 218).toFixed(1)}px)`;
    led.classList.toggle("works", v === "works" && checking !== sel);
    led.classList.toggle("broken", v === "broken" && checking !== sel);
    keys.check.classList.toggle("lit", checking === sel);
    if (angle == null) knobRot.style.transform = `rotate(${DET(sel)}deg)`;
    knob.setAttribute("aria-valuenow", String(sel + 1));
    knob.setAttribute("aria-valuetext", `${c.id}, ${c.note}, ${s.stat}`);
    const line = `${c.id} · ${c.note} · ${s.stat}`;
    outs.forEach((el) => { if (el.textContent !== line) el.textContent = line; });
  }
  function say(o, ms) { flash = o; clearTimeout(flashT); flashT = setTimeout(() => { flash = null; render(); }, ms || 1800); render(); }

  /* ---------- actions ---------- */
  function press(k) { const el = keys[k]; el.classList.add("down"); setTimeout(() => el.classList.remove("down"), 140); }
  function choose(i) { i = clamp(Math.round(i), 0, 5); if (i !== sel) { cue("detent"); sel = i; checking = -1; flash = null; } render(); }
  function rewind() { press("rewind"); choose(sel - 1); }
  function check() {
    const i = sel; checking = i; flash = null; press("check"); render();
    setTimeout(() => { if (checking !== i) return; checked[CPS[i].id] = CPS[i].v; checking = -1; render(); cue(CPS[i].v === "works" ? "success" : "failure"); }, RM ? 0 : 650);
  }
  function save() { press("save"); say({ mode: "save", id: "auto", note: "Before each prompt and rm -rf", stat: "outside your folder", sc: "" }); }
  function recover() {
    press("recover");
    const c = CPS[sel];
    if (checked[c.id] === "works") say({ mode: "recover", id: "tm/recover", note: c.id + " · new branch", stat: "nothing pushed", sc: "" }, 2400);
    else say({ mode: "recover", id: "check first", note: "Press Check to test " + c.id, stat: checked[c.id] || "not checked yet", sc: checked[c.id] || "" });
  }
  const ACT = { save, check, recover, rewind, film };
  const act = k => { finishIntro(); stopFilm(); ACT[k](); };
  Object.keys(keys).forEach((k) => keys[k].addEventListener("click", () => act(k)));
  $$("[data-dev]").forEach((b) => b.addEventListener("click", () => act(b.dataset.dev)));

  /* ---------- the dial: grab, turn, keys ---------- */
  let drag = null;
  knob.addEventListener("pointerdown", (e) => {
    finishIntro(); stopFilm();
    const r = knob.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    drag = { cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), ang: DET(sel) };
    knob.setPointerCapture(e.pointerId); e.preventDefault();
  });
  knob.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
    let d = ((a - drag.a0) * 180) / Math.PI; if (d > 180) d -= 360; if (d < -180) d += 360;
    drag.a0 = a; drag.ang = clamp(drag.ang + d, -150, 150); angle = drag.ang;
    knobRot.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    choose((angle + 135) / 54);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null; angle = null;
    if (!RM) { knobRot.style.transition = "transform .18s cubic-bezier(.3,1.6,.5,1)"; setTimeout(() => (knobRot.style.transition = ""), 200); }
    render();
  };
  knob.addEventListener("pointerup", endDrag); knob.addEventListener("pointercancel", endDrag);
  knob.addEventListener("keydown", (e) => {
    finishIntro(); stopFilm();
    const m = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (m) choose(sel + m);
    else if (e.key === "Home") choose(0);
    else if (e.key === "End") choose(5);
    else if (e.key === "Enter" || e.key === " ") check();
    else return;
    e.preventDefault();
  });

  /* ---------- size and pose ---------- */
  let mob = innerWidth <= 820;
  const base = () => {
    const d = rig.dataset;
    return { rx: +(mob ? d.mrx : d.rx) || 0, ry: +(mob ? d.mry : d.ry) || 0, rz: +(mob ? d.mrz : d.rz) || 0 };
  };
  let scale = 1, cur = base(), tgt = base(), raf = 0, visible = true;
  const pose = (p, lift) => `translate3d(0,${lift || 0}px,0) scale(${scale.toFixed(4)}) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg) rotateZ(${p.rz.toFixed(2)}deg)`;
  function fit(w, h) {
    mob = innerWidth <= 820;
    scale = Math.min(w / 460, h / 300) * (+rig.dataset.fill || 0.86);
    cur = base(); tgt = base();
    dev.style.transform = pose(cur);
  }
  // One size read at boot so power on starts at the right scale. After that the ResizeObserver hands over the size.
  fit(rig.clientWidth, rig.clientHeight);
  new ResizeObserver((es) => { const r = es[es.length - 1].contentRect; fit(r.width, r.height); }).observe(rig);

  /* Sheen and tilt follow the pointer. One rAF loop that stops when it settles, or when the device leaves the screen. */
  const front = $(".f-front", dev);
  const sheen = document.createElement("div"); sheen.className = "sheen"; sheen.setAttribute("aria-hidden", "true");
  const glint = document.createElement("i"); sheen.appendChild(glint); front.prepend(sheen);
  let gx = -0.2, gy = -0.35, tgx = gx, tgy = gy;
  glint.style.transform = `translate3d(${gx * 50}%,${gy * 50}%,0)`;
  function step() {
    raf = 0;
    if (!visible || document.hidden) return;
    const k = 0.14;
    let moving = false;
    for (const a of ["rx", "ry", "rz"]) { cur[a] += (tgt[a] - cur[a]) * k; if (Math.abs(tgt[a] - cur[a]) > 0.02) moving = true; else cur[a] = tgt[a]; }
    gx += (tgx - gx) * k; gy += (tgy - gy) * k;
    if (Math.abs(tgx - gx) + Math.abs(tgy - gy) > 0.002) moving = true;
    dev.style.transform = pose(cur);
    glint.style.transform = `translate3d(${(gx * 50).toFixed(2)}%,${(gy * 50).toFixed(2)}%,0)`;
    if (moving) raf = requestAnimationFrame(step);
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => {
      visible = es[es.length - 1].isIntersecting;
      if (!visible) { if (raf) { cancelAnimationFrame(raf); raf = 0; } stopFilm(); }
    }).observe(rig);
  }
  if (FINE && !RM) {
    const zone = rig.closest("[data-tilt-zone]") || rig;
    let box = null;
    zone.addEventListener("pointerenter", () => { box = null; });
    addEventListener("scroll", () => { box = null; }, { passive: true });
    zone.addEventListener("pointermove", (e) => {
      if (drag || LITE || !visible) return;
      if (!box) box = zone.getBoundingClientRect();
      const b = base();
      const x = clamp((e.clientX - box.left) / box.width - 0.5, -0.5, 0.5), y = clamp((e.clientY - box.top) / box.height - 0.5, -0.5, 0.5);
      tgt = { rx: b.rx - y * 12, ry: b.ry + x * 18, rz: b.rz };
      tgx = x * 0.9; tgy = y * 0.9;
      if (!raf) raf = requestAnimationFrame(step);
    });
    zone.addEventListener("pointerleave", () => { if (LITE) return; tgt = base(); tgx = -0.2; tgy = -0.35; if (!raf) raf = requestAnimationFrame(step); });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; stopFilm(); finishIntro(); }
  });

  /* A short frame-time probe after load. Slow pacing can only downgrade the tier, never upgrade it. */
  function probe() {
    if (LITE || RM || document.hidden) return;
    let prev = 0, n = 0, slow = 0;
    const tick = (t) => {
      if (document.hidden) return;
      if (prev && ++n > 3 && t - prev > 25) slow++;
      prev = t;
      if (n < 28) requestAnimationFrame(tick);
      else if (slow >= 6) { LITE = true; root.dataset.tier = "low"; tgt = base(); tgx = -0.2; tgy = -0.35; if (!raf) raf = requestAnimationFrame(step); }
    };
    requestAnimationFrame(tick);
  }
  addEventListener("load", probe);

  /* The first-visit entrance is immediately skippable. It never locks the page. */
  let introTimers = [], introAnimations = [];
  function finishIntro() {
    introTimers.forEach(clearTimeout); introTimers = [];
    introAnimations.forEach(a => a.cancel()); introAnimations = [];
    root.dataset.intro = "done"; rig.classList.remove("off"); on = true;
    Object.values(keys).forEach(k => k.classList.remove("lamp-on")); render();
  }
  addEventListener("tm:intro-end", finishIntro);
  if (RM || root.dataset.intro !== "playing" || scrollY > 100) { finishIntro(); return; }
  rig.classList.add("off"); render();
  const b = base(), light = root.dataset.introLight === "true";
  const later = (ms, fn) => introTimers.push(setTimeout(fn, ms));
  introAnimations.push(dev.animate([{ opacity: 0, transform: pose({ rx: b.rx + (light ? 0 : 24), ry: b.ry, rz: b.rz }, light ? 12 : 45) }, { opacity: 1, transform: pose(b) }],
    { duration: light ? 700 : 2200, easing: "cubic-bezier(.2,.8,.2,1)" }));
  if (!light) introAnimations.push(knobRot.animate([{ transform: `rotate(${DET(5) - 150}deg)` }, { transform: `rotate(${DET(5)}deg)` }], { duration: 2400, easing: "cubic-bezier(.2,.9,.2,1)" }));
  ["save", "check", "recover", "rewind"].forEach((k, i) => {
    later(250 + i * 150, () => keys[k].classList.add("lamp-on"));
    later(500 + i * 150, () => keys[k].classList.remove("lamp-on"));
  });
  later(light ? 450 : 1100, () => { rig.classList.remove("off"); on = true; render(); });
  later(light ? 1200 : 2900, finishIntro);
})();
