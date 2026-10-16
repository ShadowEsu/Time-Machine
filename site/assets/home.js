/* Time Machine home page: "Instrument".
   Every visual is a pure function of scroll position, so scrolling up replays the story exactly.
   The only state outside scroll is what the visitor does with the dial in the rewind act, and the Ladder fader.
   Story data is the synthetic Marigold Tips demo. IDs, verdicts and output match a real `tm demo` run;
   only 10:42 (cp-0003) and 10:51 (cp-0004) are real times, the others are illustrative. */
(() => {
  "use strict";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  let vw, vh, mob, base, M = [], paperH = 0, rowBottom = [], sumBottom = 0;
  function measure() {
    vw = innerWidth; vh = innerHeight; mob = vw <= 820;
    base = mob ? Math.min((vw - 36) / 460, 1.05) : Math.min((vw * 0.34) / 460, (vh * 0.5) / 300);
    M = acts.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, top: r.top + scrollY, h: el.offsetHeight,
        rs: $$(".r", el).map((e) => ({ e, r: (e.dataset.r || "0 0").split(" ").map(Number), last: "" })) };
    });
    paperH = paper.offsetHeight;
    rowBottom = rows.map((r) => r.offsetTop + r.offsetHeight);
    const sum = $(".pp-sum", paper);
    sumBottom = sum.offsetTop + sum.offsetHeight + 8;
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
      const shake = RM ? 0 : seg(p, 0.7, 0.72) * (1 - seg(p, 0.76, 0.8));
      const bp = POSE.brk();
      s.pose = Object.assign({}, bp, { rz: bp.rz + Math.sin(p * 900) * 1.6 * shake, x: bp.x + Math.sin(p * 1300) * 0.004 * shake });
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
      const head = rows[0].offsetTop;
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
    setText(D.mode, d.mode); setText(D.clock, d.clock); setText(D.id, d.id); setText(D.note, d.note); setText(D.stat, d.stat);
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
      knob.setAttribute("aria-valuenow", String(CPS.indexOf(c) + 1));
      knob.setAttribute("aria-valuetext", `${c.id}, ${c.note}, ${D.stat.textContent}`);
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
      if (RM) { i = i > 0 ? 1 : 0; o = o >= 1 ? 1 : 0; }
      const op = i * (1 - o), y = (1 - ease(i)) * 26 - ease(o) * 22;
      const key = op.toFixed(3) + "|" + y.toFixed(1);
      if (key !== it.last) {
        it.last = key;
        it.e.style.opacity = op.toFixed(3);
        it.e.style.transform = y ? `translate3d(0,${y.toFixed(1)}px,0)` : "none";
        it.e.style.visibility = op < 0.01 ? "hidden" : "visible";
      }
    }
  }

  /* ---------- the frame ---------- */
  let lastT = 0, lastStory = null, speed = 0, idleTimer = 0, curAct = -1, ladderP = -1, lastDone = 0;
  const appWin = $(".app-win");
  function frame() {
    raf = 0;
    const y = scrollY;
    let n = 0;
    for (let i = 0; i < M.length; i++) if (y >= M[i].top - 1) n = i;
    const m = M[n];
    let p = clamp((y - m.top) / Math.max(1, m.h - vh));
    let h = clamp((y - (m.top + m.h - vh)) / vh);
    if (RM) { p = n === 0 ? 0 : 1; h = h < 0.5 ? 0 : 1; }
    reveal(m, p);
    if (M[n + 1]) reveal(M[n + 1], RM ? 1 : 0);

    // device
    if (n <= 5) {
      setStyle(rig, "visibility", "visible");
      let s = state(n, p);
      if (h > 0 && n < 5) s = mixState(s, state(n + 1, RM ? 1 : 0), RM ? h : ease(h));
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
    } else if (y > M[6].top + vh * 0.2) setStyle(rig, "visibility", "hidden");

    // clock and proof follow scroll exactly, both ways
    if (n === 3) { const r = RM ? 1 : easeIO(seg(p, 0.14, 0.66)); setClock(lerp(T_END, CPS[2].t, r)); }
    else setClock(n < 3 ? T_END : CPS[2].t - 7);
    proof(n === 4 ? p : n < 4 ? 0 : 1);

    // plain sections: the app window settles as it arrives
    if (n >= 6 && appWin && !RM) {
      const r = appWin.getBoundingClientRect();
      const k = ease(clamp((vh - r.top) / (vh * 0.75)));
      setStyle(appWin, "transform", `perspective(1600px) rotateX(${((1 - k) * 16).toFixed(2)}deg) translate3d(0,${((1 - k) * 50).toFixed(1)}px,0)`);
    }

    // ladder
    if (n === 7 || (n === 6 && y > M[7].top - vh)) { const lp = n === 7 ? p : 0; if (lp !== ladderP) { ladderP = lp; ladderFromScroll(lp); } }

    // progress
    let a = 0; for (let i = 0; i < M.length; i++) if (y + vh * 0.5 >= M[i].top) a = i;
    setCls(body, "is-end", a === 6 || a === 8);
    setCls(body, "hud-on", y > 90);
    if (a !== curAct) { curAct = a; actN.textContent = pad(a + 1); actT.textContent = acts[a].dataset.title; bar.forEach((b, i) => setCls(b, "on", i <= a)); }
  }
  let raf = 0;
  const req = () => { if (!raf) raf = requestAnimationFrame(frame); };

  /* ---------- sound: off by default, made on the fly, nothing downloaded ---------- */
  let ac = null, soundOn = false, lastTick = 0, lastStoryMin = -1;
  const sndBtn = $("#snd");
  sndBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    sndBtn.setAttribute("aria-pressed", String(soundOn));
    $(".snd-l", sndBtn).textContent = soundOn ? "Sound on" : "Sound off";
    if (soundOn && !ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (soundOn && ac && ac.state === "suspended") ac.resume();
    if (soundOn) tick(1);
  });
  function tick(kind) {
    if (!soundOn || !ac) return;
    const pt = performance.now();
    if (pt - lastTick < 30) return; lastTick = pt;
    const len = kind === 2 ? 0.06 : 0.018;
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, kind === 2 ? 3 : 6);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = kind === 2 ? 900 : 3200; f.Q.value = kind === 2 ? 1.2 : 4;
    const g = ac.createGain(); g.gain.value = kind === 2 ? 0.45 : 0.3;
    src.connect(f).connect(g).connect(ac.destination); src.start(ac.currentTime);
  }
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
    setTimeout(() => { if (checking !== i) return; checked[CPS[i].id] = CPS[i].v; checking = null; tick(2); req(); }, RM ? 0 : 650);
  }
  keys.rewind.addEventListener("click", rewindOne);
  keys.check.addEventListener("click", runCheck);
  keys.save.addEventListener("click", () => pressKey("save"));
  keys.recover.addEventListener("click", () => pressKey("recover"));
  $("#rwBtn").addEventListener("click", rewindOne);
  $("#rwCheck").addEventListener("click", runCheck);
  $("#rwFocus").addEventListener("click", () => knob.focus());

  /* ---------- The Ladder ---------- */
  const thumb = $("#ldThumb"), track = $(".ld-track"), dig = $("#ldDig"), stepEl = $("#ldStep"), mnEl = $("#ldMn");
  const puck = $(".ld-puck"), inkOuter = $(".ld-ink"), inkInner = $(".ld-ink-in");
  const STEPS = [[1, 9, "Start"], [7, 8, "Step 2 · month 7"], [13, 7, "Step 3 · month 13"], [25, 6, "Floor · month 25"]];
  const Y = [20, 73, 126, 180];
  let userMonth = null, userAt = 0, lastStep = -1;
  function ladderFromScroll(p) {
    if (userMonth != null && Math.abs(p - userAt) > 0.05) userMonth = null;
    drawLadder(userMonth != null ? userMonth : 1 + 29 * ease(seg(p, 0.12, 0.84)));
  }
  function drawLadder(mf) {
    const mo = clamp(Math.round(mf), 1, 30), f = (mf - 1) / 29;
    let st = 0; STEPS.forEach((s, i) => { if (mo >= s[0]) st = i; });
    if (st !== lastStep) { if (lastStep !== -1) tick(2); lastStep = st; }
    dig.style.transform = `translate3d(0,${-25 * st}%,0)`;
    setText(stepEl, STEPS[st][2]); setText(mnEl, pad(mo));
    thumb.style.transform = `translate3d(${(f * track.clientWidth).toFixed(1)}px,0,0)`;
    thumb.setAttribute("aria-valuenow", String(mo)); thumb.setAttribute("aria-valuetext", `Month ${mo}, $${STEPS[st][1]} a month`);
    const gw = inkOuter.parentElement.clientWidth, gh = inkOuter.parentElement.clientHeight;
    inkOuter.style.transform = `translate3d(${(-(1 - f) * gw).toFixed(1)}px,0,0)`; inkInner.style.transform = `translate3d(${((1 - f) * gw).toFixed(1)}px,0,0)`;
    puck.style.transform = `translate3d(${(f * gw).toFixed(1)}px,${((Y[st] / 200) * gh).toFixed(1)}px,0)`;
  }
  let fdrag = false;
  const fromX = (x) => { const r = track.getBoundingClientRect(); return 1 + 29 * clamp((x - r.left) / r.width); };
  const curLP = () => { const m = M[7]; return clamp((scrollY - m.top) / Math.max(1, m.h - vh)); };
  thumb.addEventListener("pointerdown", (e) => { fdrag = true; thumb.setPointerCapture(e.pointerId); e.preventDefault(); });
  thumb.addEventListener("pointermove", (e) => { if (!fdrag) return; userMonth = fromX(e.clientX); userAt = curLP(); drawLadder(userMonth); });
  const fend = () => { if (fdrag) { fdrag = false; if (userMonth != null) { userMonth = Math.round(userMonth); drawLadder(userMonth); } } };
  thumb.addEventListener("pointerup", fend); thumb.addEventListener("pointercancel", fend);
  track.addEventListener("pointerdown", (e) => { userMonth = Math.round(fromX(e.clientX)); userAt = curLP(); drawLadder(userMonth); });
  thumb.addEventListener("keydown", (e) => {
    const cur = userMonth != null ? userMonth : 1 + Math.round(29 * ease(seg(curLP(), 0.12, 0.84)));
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -6, PageUp: 6 }[e.key];
    if (d) userMonth = clamp(cur + d, 1, 30); else if (e.key === "Home") userMonth = 1; else if (e.key === "End") userMonth = 30; else return;
    userAt = curLP(); drawLadder(userMonth); e.preventDefault();
  });

  /* ---------- small things that play once ---------- */
  const vs = $(".vs"), testsN = $("#testsN");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      if (e.target === vs) vs.classList.add("in");
      if (e.target === testsN && !RM) {
        const t0 = performance.now();
        const step = (now) => { const k = clamp((now - t0) / 1100); testsN.textContent = String(Math.round(100 * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }
    }), { threshold: 0.35 });
    io.observe(vs); io.observe(testsN);
  } else vs.classList.add("in");

  /* ---------- boot ---------- */
  addEventListener("scroll", req, { passive: true });
  addEventListener("resize", () => { measure(); lastProof = -1; ladderP = -1; req(); });
  measure(); frame();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); req(); });
  addEventListener("load", () => { measure(); req(); });
  if (!RM && scrollY < 10) {
    // power on: the instrument rises onto the table and the dial settles
    dev.animate([{ opacity: 0, translate: "0 60px" }, { opacity: 1, translate: "0 0" }], { duration: 1100, easing: "cubic-bezier(.2,.8,.2,1)" });
    knobRot.animate([{ rotate: "-80deg" }, { rotate: "0deg" }], { duration: 1500, easing: "cubic-bezier(.2,.9,.2,1)" });
    $$(".a-hero .r").forEach((e, i) => e.animate([{ opacity: 0, translate: "0 30px" }, { opacity: 1, translate: "0 0" }], { duration: 900, delay: 120 + i * 90, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
  }
})();
