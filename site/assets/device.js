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

  /* ---------- the screen ---------- */
  function render() {
    const c = CPS[sel], v = checked[c.id];
    let s = { mode: "saved", clock: c.t, id: c.id, note: c.note, stat: v || "not checked yet", sc: v || "" };
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
  function choose(i) { i = clamp(Math.round(i), 0, 5); if (i !== sel) { sel = i; checking = -1; flash = null; } render(); }
  function rewind() { press("rewind"); choose(sel - 1); }
  function check() {
    const i = sel; checking = i; flash = null; press("check"); render();
    setTimeout(() => { if (checking !== i) return; checked[CPS[i].id] = CPS[i].v; checking = -1; render(); }, RM ? 0 : 650);
  }
  function save() { press("save"); say({ mode: "save", id: "auto", note: "Before each prompt and rm -rf", stat: "outside your folder", sc: "" }); }
  function recover() {
    press("recover");
    const c = CPS[sel];
    if (checked[c.id] === "works") say({ mode: "recover", id: "tm/recover", note: c.id + " · new branch", stat: "nothing pushed", sc: "" }, 2400);
    else say({ mode: "recover", id: "check first", note: "Press Check to test " + c.id, stat: checked[c.id] || "not checked yet", sc: checked[c.id] || "" });
  }
  const ACT = { save, check, recover, rewind };
  Object.keys(ACT).forEach((k) => keys[k].addEventListener("click", ACT[k]));
  $$("[data-dev]").forEach((b) => b.addEventListener("click", () => ACT[b.dataset.dev]()));

  /* ---------- the dial: grab, turn, keys ---------- */
  let drag = null;
  knob.addEventListener("pointerdown", (e) => {
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
    if (!visible) return;
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
      if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
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

  /* ---------- power on: the device rises, the lamps test, the screen wakes, the dial settles ---------- */
  if (RM) { render(); return; }
  rig.classList.add("off");
  render();
  const b = base();
  dev.animate([{ opacity: 0, transform: pose({ rx: b.rx + 34, ry: b.ry - 10, rz: b.rz - 8 }, 70) }, { opacity: 1, transform: pose(b) }],
    { duration: LITE ? 700 : 1200, easing: "cubic-bezier(.2,.8,.2,1)" });
  knobRot.animate([{ transform: `rotate(${DET(5) - 200}deg)` }, { transform: `rotate(${DET(5)}deg)` }], { duration: LITE ? 900 : 1600, easing: "cubic-bezier(.2,.9,.2,1)" });
  const order = ["save", "check", "recover", "rewind"];
  order.forEach((k, i) => {
    setTimeout(() => keys[k].classList.add("lamp-on"), 380 + i * 110);
    setTimeout(() => keys[k].classList.remove("lamp-on"), 620 + i * 110);
  });
  setTimeout(() => {
    rig.classList.remove("off");
    say({ mode: "power", clock: CPS[5].t, id: "tm · v0", note: "6 save points found", stat: "not checked yet", sc: "" }, 1100);
    dots.forEach((el, i) => setTimeout(() => el.classList.add("on"), i * 90));
    setTimeout(() => { on = true; }, 6 * 90);
  }, LITE ? 500 : 820);
})();
