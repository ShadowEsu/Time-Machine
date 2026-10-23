/* Time Machine story page: "Instrument".
   Every visual is a pure function of scroll position, so scrolling up replays the story exactly.
   The only state outside scroll is what the visitor does with the dial in the rewind act.
   Story data is the synthetic Marigold Tips demo. IDs, verdicts and output match a real `tm demo` run;
   only 10:42 (cp-0003) and 10:51 (cp-0004) are real times, the others are illustrative. */
(() => {
  "use strict";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  // The head script sets data-tier from cores, memory and Save-Data. A short probe after load can only
  // downgrade it, so the page never flickers between tiers. The probe is bounded, never a permanent loop.
  let low = root.dataset.tier === "low";
  function probe() {
    if (low || RM || document.hidden) return;
    let prev = 0, n = 0, slow = 0;
    const step = (t) => {
      if (document.hidden) return;
      if (prev && ++n > 3 && t - prev > 25) slow++;
      prev = t;
      if (n < 28) requestAnimationFrame(step);
      else if (slow >= 6) { low = true; root.dataset.tier = "low"; req(); }
    };
    requestAnimationFrame(step);
  }
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (p, a, b) => (b <= a ? (p >= a ? 1 : 0) : clamp((p - a) / (b - a)));
  const ease = (t) => t * t * (3 - 2 * t);
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const back = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

  /* ---------- story data ---------- */
  const T = (s) => { const [h, m, x = 0] = s.split(":").map(Number); return h * 3600 + m * 60 + x; };
  const CPS = [
    { id: "cp-0001", t: T("10:05"), note: "Initial tip calculator", v: "works" },
    { id: "cp-0002", t: T("10:20"), note: "Added split bill", v: "works" },
    { id: "cp-0003", t: T("10:42:07"), note: "Added dark mode", v: "works" },
    { id: "cp-0004", t: T("10:51"), note: "Agent: fixed lint warnings", v: "broken" },
    { id: "cp-0005", t: T("11:04"), note: "Changed currency", v: "broken" },
    { id: "cp-0006", t: T("11:12"), note: "Added a dependency", v: "broken" },
  ];
  const T_END = T("11:14");
  const DET = (i) => -135 + i * 54;
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (t) => { t = Math.round(t); return pad(Math.floor(t / 3600)) + ":" + pad(Math.floor(t / 60) % 60) + ":" + pad(t % 60); };
  const cpAt = (t) => { let k = 0; CPS.forEach((c, i) => { if (c.t <= t + 0.5) k = i; }); return k; };
  const headAt = (t) => {
    if (t >= CPS[5].t) return 5 + clamp((t - CPS[5].t) / (T_END - CPS[5].t)) * 0.35;
    for (let i = 0; i < 5; i++) if (t < CPS[i + 1].t) return i + clamp((t - CPS[i].t) / (CPS[i + 1].t - CPS[i].t));
    return 5;
  };
  const BREAK_T = [[0.04, T("10:42:07")], [0.3, T("10:44")], [0.36, T("10:51")], [0.42, T("11:04")], [0.5, T("11:12")], [0.58, T("11:13")], [0.7, T_END]];
  const kf = (p, K) => { if (p <= K[0][0]) return K[0][1]; for (let i = 1; i < K.length; i++) if (p < K[i][0]) return lerp(K[i - 1][1], K[i][1], (p - K[i - 1][0]) / (K[i][0] - K[i - 1][0])); return K[K.length - 1][1]; };
  const BLOG = [
    [0.3, "> fix the lint warnings"], [0.34, "edit  src/tips.js"], [0.36, "saved cp-0004"], [0.42, "saved cp-0005"],
    [0.5, "saved cp-0006"], [0.58, "agent: All done!"], [0.7, "$ npm test   exit code 1", 1],
  ];
  // proof act timing: check i runs from CA(i) to CA(i) + CD, newest first
  const CA = (i) => 0.2 + i * 0.15, CD = 0.1;

  /* ---------- elements ---------- */
  const acts = $$("[data-act]");
  const rig = $("#rig"), dev = $("#dev"), knob = $("#knob"), knobRot = $("#knobRot"), hint = $("#knobHint");
  const night = $("#night"), paper = $("#paper"), led = $("#led"), screen = $("#screen");
  const D = { mode: $("#dMode"), clock: $("#dClock"), id: $("#dId"), note: $("#dNote"), log: $("#dLog"), stat: $("#dStat"), head: $("#dHead") };
  const dots = $$("#dLine i");
  const keys = {}; $$(".key").forEach((k) => (keys[k.dataset.k] = k));
  const rows = $$(".pp-row", paper);
  const actN = $("#actN"), actT = $("#actT"), bar = $$("#actBar i");
  const speedEl = $("#rwSpeed");
  const body = document.body;

  /* ---------- the rolling clock (rewind act) ---------- */
  const clockEl = $("#clock");
  const strip = (cells) => {
    const dg = document.createElement("span"); dg.className = "dg"; dg.setAttribute("aria-hidden", "true");
    const sp = document.createElement("span"); sp.className = "strip";
    sp.innerHTML = cells.map((c) => "<i>" + c + "</i>").join("");
    dg.appendChild(sp); clockEl.appendChild(dg); return sp;
  };
  const D10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0], D6 = [0, 1, 2, 3, 4, 5, 0];
  const cHT = strip(D10), cHO = strip(D10);
  const colon = document.createElement("span"); colon.className = "colon"; colon.textContent = ":"; colon.setAttribute("aria-hidden", "true"); clockEl.appendChild(colon);
  const cMT = strip(D6), cMO = strip(D10);
  let lastClock = null;
  function setClock(sec) {
    let v = sec / 60;
    const f = Math.floor(v); v = f + ease(seg(v - f, 0.55, 1));
    if (v === lastClock) return; lastClock = v;
    const m = v % 60, h = Math.floor(v / 60), mo = m % 10;
    const mt = Math.floor(m / 10) + Math.max(0, mo - 9);
    const carryH = Math.max(0, m - 59);
    const ho = (h % 10) + carryH, ht = Math.floor(h / 10) + (h % 10 === 9 ? carryH : 0);
    cHT.style.transform = `translate3d(0,${-ht}em,0)`; cHO.style.transform = `translate3d(0,${-ho}em,0)`;
    cMT.style.transform = `translate3d(0,${-mt}em,0)`; cMO.style.transform = `translate3d(0,${-mo}em,0)`;
  }

  /* ---------- proof cards and terminal ---------- */
  const cards = $$(".pc").map((c) => ({ el: c, bar: $(".pc-bar i", c), s: $(".pc-s", c), st: $(".stamp", c) }));
  const words = $$(".pw"), tls = $$(".tl");
  let lastProof = -1;
  function proof(p) {
    if (p === lastProof) return; lastProof = p;
    cards.forEach((c, i) => {
      const a = CA(i), b = a + CD, fill = seg(p, a, b);
      c.bar.style.transform = `scaleX(${fill.toFixed(3)})`;
      c.el.style.transform = fill > 0 && fill < 1 ? `translate3d(0,${(-Math.sin(Math.PI * fill) * 10).toFixed(1)}px,0)` : "none";
      c.s.style.opacity = seg(p, b, b + 0.02).toFixed(3);
      const sp = RM ? (p >= b ? 1 : 0) : seg(p, b, b + 0.06);
      c.st.style.opacity = (RM ? sp : seg(p, b, b + 0.012)).toFixed(3);
      c.st.style.transform = `rotate(${i === 3 ? -6 : -9}deg) scale(${(1.9 - 0.9 * back(sp)).toFixed(3)})`;
      const wv = RM ? (p >= b ? 1 : 0) : seg(p, b, b + 0.04);
      words[i].style.opacity = wv.toFixed(3);
      words[i].style.transform = `translate3d(0,${((1 - ease(wv)) * 30).toFixed(1)}px,0)`;
    });
    tls.forEach((l) => {
      const i = +l.dataset.i;
      const v = i < 0 ? seg(p, 0.02, 0.06) : i < 4 ? seg(p, CA(i) + CD, CA(i) + CD + 0.02) : seg(p, 0.82, 0.86);
      l.style.opacity = (RM ? (v > 0 ? 1 : 0) : v).toFixed(3);
    });
  }

  /* ---------- measure ---------- */
  let vw, vh, mob, base, M = [], paperH = 0, rowHead = 0, rowBottom = [], sumBottom = 0;
  let appTop = 0, slots = [];
  function measure() {
    vw = innerWidth; vh = innerHeight; mob = vw <= 820;
    base = mob ? Math.min((vw - 36) / 460, 1.05) : Math.min((vw * 0.34) / 460, (vh * 0.5) / 300);
    M = acts.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, top: r.top + scrollY, h: el.offsetHeight,
        // Heading text is only faded, never visibility-hidden, so assistive tech always gets the heading and the
        // section labels that point at it. Every faded block, heading or not, stops taking clicks while invisible.
        rs: $$(".r", el).map((e) => ({ e, head: !!e.closest("h1, h2, h3, h4, h5, h6"), r: (e.dataset.r || "0 0").split(" ").map(Number), last: "" })) };
    });
    paperH = paper.offsetHeight;
    rowHead = rows[0].offsetTop;
    rowBottom = rows.map((r) => r.offsetTop + r.offsetHeight);
    const sum = $(".pp-sum", paper);
    sumBottom = sum.offsetTop + sum.offsetHeight + 8;
    if (appWin) appTop = appWin.getBoundingClientRect().top + scrollY;
    // Reserve real text height, including wrapping and the reduced-motion still.
    // No device pose can intrude into this phone-sized reading area.
    slots = mob ? acts.slice(0, 4).map((el, i) => {
      const stageTop = $(".stage", el).getBoundingClientRect().top;
      const copyTop = $(i === 0 ? ".hero-sub" : i === 3 ? ".rw-bot" : ".copy", el).getBoundingClientRect().top - stageTop;
      const top = i === 0 ? $(".hero-h", el).getBoundingClientRect().bottom - stageTop + 16
        : i === 3 ? $(".rw-top", el).getBoundingClientRect().bottom - stageTop + 16 : 70;
      return { top, bottom: copyTop - 20 };
    }) : [];
  }

  /* ---------- poses: x, y as viewport fractions, s on top of the base scale ---------- */
  const P = (d, m) => () => (mob ? m : d);
  const POSE = {
    hero0: P({ x: 0.72, y: 0.66, s: 1.28, rx: 56, ry: 0, rz: -26 }, { x: 0.5, y: 0.46, s: 0.86, rx: 54, ry: 0, rz: -20 }),
    hero1: P({ x: 0.74, y: 0.62, s: 1.0, rx: 14, ry: -20, rz: 2 }, { x: 0.5, y: 0.5, s: 0.94, rx: 16, ry: -8, rz: 0 }),
    promise: P({ x: 0.7, y: 0.52, s: 1.1, rx: 6, ry: -12, rz: 0 }, { x: 0.5, y: 0.25, s: 0.86, rx: 8, ry: 0, rz: 0 }),
    brk: P({ x: 0.7, y: 0.52, s: 1.06, rx: 5, ry: -15, rz: 0 }, { x: 0.5, y: 0.2, s: 0.74, rx: 6, ry: 0, rz: 0 }),
    rewA: P({ x: 0.5, y: 0.645, s: 0.9, rx: 4, ry: 0, rz: 0 }, { x: 0.5, y: 0.5, s: 1.0, rx: 2, ry: 0, rz: 0 }),
    rewB: P({ x: 0.5, y: 0.52, s: 1.12, rx: 0, ry: 0, rz: 0 }, { x: 0.5, y: 0.43, s: 1.0, rx: 0, ry: 0, rz: 0 }),
    proof: P({ x: 0.79, y: 0.775, s: 0.95, rx: 12, ry: -12, rz: 0 }, { x: 0.5, y: 0.9, s: 0.78, rx: 8, ry: 0, rz: 0 }),
    report: P({ x: 0.76, y: 0.775, s: 1.0, rx: 8, ry: -12, rz: 0 }, { x: 0.5, y: 0.9, s: 0.78, rx: 8, ry: 0, rz: 0 }),
  };
  const mixPose = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s: lerp(a.s, b.s, t), rx: lerp(a.rx, b.rx, t), ry: lerp(a.ry, b.ry, t), rz: lerp(a.rz, b.rz, t) });

  /* ---------- the visitor's own dial (rewind act only) ---------- */
  let live = false, userSel = null, userAngle = null, checked = {}, checking = null;

  /* ---------- device state per act ---------- */
  const scr = (o) => Object.assign({ mode: "ready", clock: "10:42:07", id: "cp-0003", note: "Added dark mode", stat: "not checked yet", sc: "", log: null, dots: [1, 1, 1, 0, 0, 0], dv: [], head: 2 }, o);
  function state(n, p) {
    const s = { night: 0, paper: 0, lit: {}, down: {}, led: "", hint: 0, stamps: 0 };
    if (n === 0) {
      s.pose = mixPose(POSE.hero0(), POSE.hero1(), ease(seg(p, 0, 0.9)));
      s.knob = lerp(-110, -27, ease(seg(p, 0, 0.9)));
      s.scr = scr({ mode: "saved" });
    } else if (n === 1) {
      s.pose = mixPose(POSE.hero1(), POSE.promise(), ease(seg(p, 0, 0.3)));
      s.knob = -27 + 360 * ease(seg(p, 0.04, 0.8));
      const ph = p < 0.06 ? -1 : p < 0.28 ? 0 : p < 0.5 ? 1 : p < 0.76 ? 2 : 3;
      const names = ["save", "check", "recover"];
      if (ph >= 0 && ph < 3) { s.lit[names[ph]] = 1; if (p - [0.06, 0.28, 0.5][ph] < 0.035) s.down[names[ph]] = 1; }
      s.scr = [
        scr({ mode: "saved" }),
        scr({ mode: "save", id: "saved", note: "Before each prompt and rm -rf", stat: "cp-0003" }),
        scr({ mode: "check", id: "check", note: "Separate copy. Network off.", stat: "your own test" }),
        scr({ mode: "recover", id: "branch", note: "New branch. Folder untouched.", stat: "nothing pushed" }),
        scr({ mode: "saved" }),
      ][ph + 1];
    } else if (n === 2) {
      const t = kf(p, BREAK_T), h = headAt(t), k = cpAt(t);
      s.knob = 360 + lerp(DET(2), DET(5), clamp((h - 2) / 3));
      s.pose = POSE.brk();
      if ([0.36, 0.42, 0.5].some((e) => p >= e && p < e + 0.03)) { s.lit.save = 1; s.down.save = 1; }
      s.led = p >= 0.7 ? "broken" : "";
      s.scr = scr({ mode: p < 0.3 ? "saved" : "agent", clock: fmt(t), id: CPS[k].id, note: CPS[k].note, stat: p >= 0.7 ? "your test failed" : "not checked yet",
        log: p >= 0.3 ? BLOG.filter((l) => p >= l[0]).slice(-5) : null, dots: CPS.map((c) => (c.t <= t + 0.5 ? 1 : 0)), head: h });
    } else if (n === 3) {
      s.pose = mixPose(POSE.rewA(), POSE.rewB(), ease(seg(p, 0.66, 0.76)));
      s.night = seg(p, 0, 0.08);
      const r = easeIO(seg(p, 0.14, 0.66));
      const t = lerp(T_END, CPS[2].t, r), k = cpAt(t);
      s.knob = lerp(360 + DET(5) + 6, -720 + DET(2), r);
      if (r > 0 && r < 1) s.lit.rewind = 1;
      s.scr = scr({ mode: r > 0 && r < 1 ? "rewind" : r >= 1 ? "preview" : "now", clock: fmt(t), id: CPS[k].id, note: CPS[k].note, dots: [1, 1, 1, 1, 1, 1], head: headAt(t) });
      s.rewT = t;
      if (p >= 0.72) {
        s.live = 1; s.hint = seg(p, 0.72, 0.8);
        const sel = userSel == null ? 2 : userSel;
        s.knob = -720 + (userAngle == null ? DET(sel) : userAngle);
        const c = CPS[sel], v = checked[c.id];
        s.scr = scr({ mode: checking === sel ? "checking" : "your turn", clock: fmt(c.t), id: c.id, note: c.note, dots: [1, 1, 1, 1, 1, 1], head: sel,
          stat: checking === sel ? "checking · network off" : v || "not checked yet",
          sc: checking === sel ? "" : v || "", dv: Object.keys(checked).map((id) => [CPS.findIndex((x) => x.id === id), checked[id]]) });
        if (v && checking !== sel) s.led = v;
        if (checking === sel) { s.lit.check = 1; s.down.check = 1; }
      }
    } else if (n === 4) {
      s.pose = POSE.proof();
      const head = rowHead;
      let fed = lerp(0, head, seg(p, 0.08, 0.18));
      let done = 0, chk = -1;
      for (let i = 0; i < 4; i++) {
        const a = CA(i), b = a + CD;
        if (p >= a) { fed = lerp(i ? rowBottom[i - 1] : head, rowBottom[i], ease(seg(p, a, b))); chk = p < b ? i : -1; if (p >= b) done = i + 1; }
      }
      if (p >= 0.8) fed = lerp(rowBottom[3], sumBottom, ease(seg(p, 0.8, 0.86)));
      s.paper = fed; s.stamps = done; s.done = done;
      const ang = (i) => -720 + DET(5 - i);
      if (done >= 4) s.knob = -720 + DET(2);
      else if (chk >= 0) s.knob = lerp(ang(Math.max(0, chk - 1)), ang(chk), chk === 0 ? 1 : ease(seg(p, CA(chk), CA(chk) + 0.05)));
      else s.knob = ang(Math.max(0, done - 1));
      const dv = []; for (let i = 0; i < done; i++) dv.push([5 - i, i === 3 ? "works" : "broken"]);
      const last = done ? (done === 4 ? "works" : "broken") : "";
      if (chk >= 0) { s.lit.check = 1; s.down.check = seg(p, CA(chk), CA(chk) + 0.03) < 1 ? 1 : 0; }
      s.led = chk >= 0 ? "" : last;
      const c = CPS[chk >= 0 ? 5 - chk : done ? 6 - done : 5];
      s.scr = scr({ mode: chk >= 0 ? "checking" : "find-good", clock: fmt(c.t), id: c.id, note: chk >= 0 ? "Separate copy. Network off." : c.note,
        stat: chk >= 0 ? "running your check" : done ? last : "newest first", sc: chk >= 0 ? "" : last, dots: [1, 1, 1, 1, 1, 1], dv, head: CPS.indexOf(c) });
    } else {
      s.pose = mixPose(POSE.proof(), POSE.report(), ease(seg(p, 0, 0.3)));
      s.paper = lerp(sumBottom, paperH, ease(seg(p, 0.08, 0.72)));
      s.stamps = 4; s.done = 4; s.led = "works"; s.knob = -720 + DET(2);
      if (p > 0.04 && p < 0.7) { s.lit.recover = 1; if (p < 0.08) s.down.recover = 1; }
      s.scr = scr({ mode: p < 0.04 ? "find-good" : "recover", clock: "10:42:07", id: p < 0.04 ? "cp-0003" : "tm/recover", note: p < 0.04 ? "Added dark mode" : "cp-0003 · new branch", stat: "works", sc: "works",
        dots: [1, 1, 1, 1, 1, 1], dv: [[5, "broken"], [4, "broken"], [3, "broken"], [2, "works"]], head: 2 });
    }
    return s;
  }

  /* ---------- render ---------- */
  const cache = new Map();
  const setText = (el, v) => { if (cache.get(el) !== v) { cache.set(el, v); el.textContent = v; } };
  // Screen labels are sentence case; the state words stay lowercase in state() because they double as class names.
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const setCls = (el, c, on) => { if (el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); };
  const styleCache = new WeakMap();
  const setStyle = (el, k, v) => { let m = styleCache.get(el); if (!m) styleCache.set(el, (m = {})); if (m[k] !== v) { m[k] = v; el.style[k] = v; } };

  function paint(s) {
    const p = s.pose, sc = base * p.s;
    setStyle(dev, "transform", `translate3d(${(p.x * vw - 230).toFixed(1)}px,${(p.y * vh - 150).toFixed(1)}px,0) scale(${sc.toFixed(4)}) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg) rotateZ(${p.rz.toFixed(2)}deg)`);
    setStyle(knobRot, "transform", `rotate(${s.knob.toFixed(2)}deg)`);
    setStyle(night, "opacity", s.night.toFixed(3));
    setCls(body, "is-night", s.night > 0.5);
    setStyle(paper, "transform", `translate3d(0,${(paperH + 10 - s.paper).toFixed(1)}px,0)`);
    rows.forEach((r, i) => setCls(r, "on", i < s.stamps));
    for (const k in keys) { setCls(keys[k], "lit", s.lit[k]); setCls(keys[k], "down", s.down[k]); }
    setCls(led, "works", s.led === "works"); setCls(led, "broken", s.led === "broken");
    setStyle(hint, "opacity", String(s.hint));
    const L = !!s.live;
    if (L !== live) {
      live = L; setCls(rig, "live", L); knob.tabIndex = L ? 0 : -1;
      Object.values(keys).forEach((k) => (k.tabIndex = L ? 0 : -1));
      if (!L) { userSel = null; userAngle = null; checked = {}; checking = null; if (rig.contains(document.activeElement)) document.activeElement.blur(); }
    }
    const d = s.scr;
    setText(D.mode, cap(d.mode)); setText(D.clock, d.clock); setText(D.id, d.id); setText(D.note, d.note); setText(D.stat, cap(d.stat));
    const cls = "scr-stat " + (d.sc || "");
    if (D.stat.className !== cls) D.stat.className = cls;
    setCls(screen, "mode-log", !!d.log);
    if (d.log) {
      const html = d.log.map((l) => `<p${l[2] ? ' class="hl"' : ""}>${l[1].replace(/</g, "&lt;")}</p>`).join("");
      if (cache.get(D.log) !== html) { cache.set(D.log, html); D.log.innerHTML = html; }
    }
    const dvm = {}; d.dv.forEach(([i, v]) => (dvm[i] = v));
    dots.forEach((el, i) => { setCls(el, "on", d.dots[i]); setCls(el, "works", dvm[i] === "works"); setCls(el, "broken", dvm[i] === "broken"); });
    setStyle(D.head, "transform", `translateX(${(clamp(d.head, 0, 5.35) * 0.2 * 218).toFixed(1)}px)`);
    if (live) {
      const c = CPS[userSel == null ? 2 : userSel];
      const val = String(CPS.indexOf(c) + 1), text = `${c.id}, ${c.note}, ${D.stat.textContent}`;
      if (knob.getAttribute("aria-valuenow") !== val) knob.setAttribute("aria-valuenow", val);
      if (knob.getAttribute("aria-valuetext") !== text) knob.setAttribute("aria-valuetext", text);
    }
  }

  function mixState(a, b, t) {
    const o = t < 0.5 ? Object.assign({}, a) : Object.assign({}, b);
    o.pose = mixPose(a.pose, b.pose, t); o.knob = lerp(a.knob, b.knob, t); o.night = lerp(a.night, b.night, t); o.paper = lerp(a.paper, b.paper, t);
    o.live = t < 0.05 ? a.live : 0;
    return o;
  }

  function reveal(m, p) {
    for (const it of m.rs) {
      const [a, b, c, d] = it.r;
      let i = a === b ? (p >= a ? 1 : 0) : seg(p, a, b);
      let o = c == null ? 0 : seg(p, c, d);
      // Reduced motion: no fades. A line shows once its range starts and goes as soon as its exit starts,
      // so two lines stacked in one place never overlap.
      if (RM) { i = i > 0 ? 1 : 0; o = o > 0 ? 1 : 0; }
      const op = i * (1 - o), y = (1 - ease(i)) * 26 - ease(o) * 22;
      const key = op.toFixed(3) + "|" + y.toFixed(1);
      if (key !== it.last) {
        it.last = key;
        it.e.style.opacity = op.toFixed(3);
        it.e.style.transform = y ? `translate3d(0,${y.toFixed(1)}px,0)` : "none";
        if (!it.head) it.e.style.visibility = op < 0.01 ? "hidden" : "visible";
        it.e.style.pointerEvents = op < 0.01 ? "none" : "";
      }
    }
  }

  /* ---------- the frame ---------- */
  let lastT = 0, lastStory = null, speed = 0, idleTimer = 0, curAct = -1, lastDone = 0;
  const appWin = $(".app-win");
  function frame() {
    raf = 0;
    const y = scrollY;
    let n = 0;
    for (let i = 0; i < M.length; i++) if (y >= M[i].top - 1) n = i;
    const m = M[n];
    let p = clamp((y - m.top) / Math.max(1, m.h - vh));
    let h = clamp((y - (m.top + m.h - vh)) / vh);
    // Reduced motion: the device, clock and proof cards stay on each act's final still, but text still steps
    // through its own range (snapped, no fades or slides), so lines that give way to later ones are seen first.
    const rp = p;
    if (RM) { p = n === 0 ? 0 : 1; h = h < 0.5 ? 0 : 1; }
    reveal(m, rp);
    if (M[n + 1]) reveal(M[n + 1], 0);

    // device
    if (n <= 5) {
      const slot = slots[n];
      const show = mob ? n < 4 && h === 0 && (!slot || slot.bottom - slot.top >= 100) : n < 5 || h === 0;
      setStyle(rig, "visibility", show ? "visible" : "hidden");
      let s = state(n, p);
      if (!mob && h > 0 && n < 5) s = mixState(s, state(n + 1, RM ? 1 : 0), RM ? h : ease(h));
      if (slot) {
        // 360 covers the 300 px face plus its depth and perspective; the sine term covers a rotated device.
        s.pose = { ...s.pose, y: (slot.top + slot.bottom) / (2 * vh),
          s: Math.min(s.pose.s, (slot.bottom - slot.top) / (base * (360 + 460 * Math.abs(Math.sin(s.pose.rz * Math.PI / 180))))) };
      }
      if (!show) s.live = 0;
      paint(s);
      const done = n === 4 ? s.done : n > 4 ? 4 : 0;
      if (done !== lastDone) { if (done > lastDone) tick(2); lastDone = done; }
      if (n === 3 && s.rewT != null && !RM) {
        const now = performance.now();
        if (lastStory != null && now > lastT) { const v = (lastStory - s.rewT) / ((now - lastT) / 1000); speed = lerp(speed, v, 0.35); }
        lastStory = s.rewT; lastT = now;
        const a = Math.abs(speed);
        setText(speedEl, a < 5 ? "paused" : (speed > 0 ? "back " : "forward ") + (Math.round(a / 10) * 10).toLocaleString("en-US") + "×");
        clearTimeout(idleTimer); idleTimer = setTimeout(() => { speed = 0; setText(speedEl, "paused"); }, 160);
        tickOnStory(s.rewT);
      } else lastStory = null;
    } else setStyle(rig, "visibility", "hidden");

    // clock and proof follow scroll exactly, both ways
    if (n === 3) { const r = RM ? 1 : easeIO(seg(p, 0.14, 0.66)); setClock(lerp(T_END, CPS[2].t, r)); }
    else setClock(n < 3 ? T_END : CPS[2].t - 7);
    proof(n === 4 ? p : n < 4 ? 0 : 1);

    // plain sections: the app window settles as it arrives
    if (n >= 6 && appWin && !RM && !low) {
      const k = ease(clamp((vh - (appTop - y)) / (vh * 0.75)));
      setStyle(appWin, "transform", `perspective(1600px) rotateX(${((1 - k) * 16).toFixed(2)}deg) translate3d(0,${((1 - k) * 50).toFixed(1)}px,0)`);
    }


    // progress
    let a = 0; for (let i = 0; i < M.length; i++) if (y + vh * 0.5 >= M[i].top) a = i;
    setCls(body, "is-end", n === 6 || n >= 8 || h > 0);
    setCls(body, "hud-on", y > 90);
    if (a !== curAct) { curAct = a; actN.textContent = pad(a + 1); actT.textContent = acts[a].dataset.title; bar.forEach((b, i) => setCls(b, "on", i <= a)); }
  }
  let raf = 0;
  const req = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };

  /* Shared procedural sound stays off until a gesture. Mute and hidden stop every voice. */
  let lastStoryMin = -1;
  function tick() { window.TMSound?.cue("detent"); }
  function tickOnStory(t) { const k = Math.floor(t / 60); if (k !== lastStoryMin) { if (lastStoryMin !== -1) tick(1); lastStoryMin = k; } }

  /* ---------- the dial: grab, turn, keys ---------- */
  function setSel(i, fromDrag) {
    i = clamp(Math.round(i), 0, 5);
    if (i !== userSel) tick(1);
    userSel = i; if (!fromDrag) userAngle = null;
    req();
  }
  let drag = null;
  knob.addEventListener("pointerdown", (e) => {
    if (!live) return;
    const r = knob.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    drag = { cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), ang: userAngle == null ? DET(userSel == null ? 2 : userSel) : userAngle };
    knob.setPointerCapture(e.pointerId); e.preventDefault();
  });
  knob.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
    let d = ((a - drag.a0) * 180) / Math.PI; if (d > 180) d -= 360; if (d < -180) d += 360;
    drag.a0 = a; drag.ang = clamp(drag.ang + d, -150, 150);
    userAngle = drag.ang;
    const i = Math.round((drag.ang + 135) / 54);
    if (i !== userSel) { checking = null; setSel(i, true); } else req();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null; userAngle = null;
    if (!RM) { knobRot.style.transition = "transform .18s cubic-bezier(.3,1.6,.5,1)"; setTimeout(() => (knobRot.style.transition = ""), 200); }
    req();
  };
  knob.addEventListener("pointerup", endDrag); knob.addEventListener("pointercancel", endDrag);
  knob.addEventListener("keydown", (e) => {
    if (!live) return;
    const cur = userSel == null ? 2 : userSel;
    const map = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
    if (map[e.key]) { checking = null; setSel(cur + map[e.key]); e.preventDefault(); }
    else if (e.key === "Home") { setSel(0); e.preventDefault(); }
    else if (e.key === "End") { setSel(5); e.preventDefault(); }
    else if (e.key === "Enter" || e.key === " ") { runCheck(); e.preventDefault(); }
  });
  function pressKey(k) { const el = keys[k]; el.classList.add("down"); tick(2); setTimeout(() => el.classList.remove("down"), 140); }
  function rewindOne() { if (!live) return; checking = null; setSel((userSel == null ? 2 : userSel) - 1); pressKey("rewind"); }
  // Replays the recorded verdicts of the demo project. Nothing runs in your browser.
  function runCheck() {
    if (!live) return;
    const i = userSel == null ? 2 : userSel; checking = i; pressKey("check"); req();
    setTimeout(() => { if (checking !== i) return; checked[CPS[i].id] = CPS[i].v; checking = null; window.TMSound?.cue(CPS[i].v === "works" ? "success" : "failure"); req(); }, RM ? 0 : 650);
  }
  keys.rewind.addEventListener("click", rewindOne);
  keys.check.addEventListener("click", runCheck);
  keys.save.addEventListener("click", () => pressKey("save"));
  keys.recover.addEventListener("click", () => pressKey("recover"));
  $("#rwBtn").addEventListener("click", rewindOne);
  $("#rwCheck").addEventListener("click", runCheck);
  $("#rwFocus").addEventListener("click", () => knob.focus());

  /* ---------- small things that play once ---------- */
  const vs = $(".vs"), testsN = $("#testsN");
  // The count lives in the HTML only, so the animation can never end on a stale number.
  const testsTotal = testsN.textContent.trim();
  let countRaf = 0;
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) {
        if (e.target === testsN && countRaf) { cancelAnimationFrame(countRaf); countRaf = 0; testsN.textContent = testsTotal; io.unobserve(testsN); }
        return;
      }
      if (e.target === vs) { vs.classList.add("in"); io.unobserve(vs); }
      if (e.target === testsN) {
        if (RM || low) { io.unobserve(testsN); return; }
        const t0 = performance.now();
        const step = (now) => {
          const k = clamp((now - t0) / 1100);
          testsN.textContent = String(Math.round(Number(testsTotal) * (1 - Math.pow(1 - k, 3))));
          if (k < 1 && !document.hidden) countRaf = requestAnimationFrame(step);
          else { countRaf = 0; testsN.textContent = testsTotal; io.unobserve(testsN); }
        };
        countRaf = requestAnimationFrame(step);
      }
    }), { threshold: 0.35 });
    io.observe(vs); io.observe(testsN);
  } else vs.classList.add("in");

  /* ---------- boot ---------- */
  addEventListener("scroll", req, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (countRaf) { cancelAnimationFrame(countRaf); countRaf = 0; testsN.textContent = testsTotal; }
    } else req();
  });
  addEventListener("resize", () => { measure(); lastProof = -1; req(); });
  measure(); frame();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); req(); });
  addEventListener("load", () => { measure(); req(); probe(); });
  if (!RM && scrollY < 10) {
    // power on: the instrument rises onto the table and the dial settles. Shorter on weak devices.
    const k = low ? 0.6 : 1;
    dev.animate([{ opacity: 0, translate: "0 60px" }, { opacity: 1, translate: "0 0" }], { duration: 1100 * k, easing: "cubic-bezier(.2,.8,.2,1)" });
    knobRot.animate([{ rotate: "-80deg" }, { rotate: "0deg" }], { duration: 1500 * k, easing: "cubic-bezier(.2,.9,.2,1)" });
    $$(".a-hero .r").forEach((e, i) => e.animate([{ opacity: 0, translate: "0 30px" }, { opacity: 1, translate: "0 0" }], { duration: 900 * k, delay: 120 + i * 90, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
  }
})();
