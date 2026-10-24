/* The save-point tree on home: a replay of a real `tm demo` run, drawn as pixel art.
   Find checks newest first and stops at the first PASS (tm find-good). Bring back saves the current state first
   (cp-0007), grows the tm/recover/cp-0003 branch and puts the recovery copy beside the project (tm recover).
   Undo removes the copy and the branch; save points stay (the web app's Undo this rewind).
   Without JS the section shows the static result list. With reduced motion every step is instant. */
(function () {
  "use strict";
  var card = document.querySelector("[data-tree]");
  if (!card) return;
  var canvas = card.querySelector(".tree-canvas");
  var ctx = canvas && canvas.getContext("2d");
  if (!ctx) return;
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // From the demo: ids, notes and the verdicts tm find-good printed (cp-0001 and cp-0002 are never reached).
  var POINTS = [
    { id: "cp-0001", note: "Initial tip calculator", real: null },
    { id: "cp-0002", note: "Added split bill", real: null },
    { id: "cp-0003", note: "Added dark mode", real: "PASS" },
    { id: "cp-0004", note: "Agent: fixed lint warnings", real: "FAIL" },
    { id: "cp-0005", note: "Changed currency", real: "FAIL" },
    { id: "cp-0006", note: "Added a dependency", real: "FAIL" },
    { id: "cp-0007", note: "Before recovering cp-0003", real: null, later: true }
  ];
  var FAIL_LINE = "The check failed with exit code 1.";
  var RECOVER_OUT = [
    "Recovery ready for cp-0003. Nothing was pushed, merged or deployed. Your folder and branch were not touched.",
    "  Branch          tm/recover/cp-0003",
    "  Recovery copy   \u2026/marigold-tips-recovered-cp-0003",
    "  Saved first     cp-0007, your state before this recovery",
    "  Last check      PASS",
    "Not restored",
    "  Secret values in .env: PORT, STRIPE_SECRET_KEY"
  ];
  var WORD = { PASS: "Works", FAIL: "Broken", checking: "Checking", none: "Not checked yet" };
  var C = { ink: "#141414", ink3: "#66635d", grid: "#e9e5dc", paper: "#ffffff", works: "#17733e", broken: "#b3261e" };

  var stage = card.querySelector(".tree-stage");
  var nodesBox = card.querySelector(".tree-nodes");
  var read = card.querySelector(".tree-read");
  var acts = card.querySelector(".tree-acts");
  var logEl = card.querySelector(".tree-log");
  var status = card.querySelector("[data-tree-status]");
  var bFind = card.querySelector("[data-tree-find]");
  var bBack = card.querySelector("[data-tree-back]");
  var bUndo = card.querySelector("[data-tree-undo]");
  var bReset = card.querySelector("[data-tree-reset]");
  var outId = card.querySelector("[data-tree-id]");
  var outVerdict = card.querySelector("[data-tree-verdict]");
  var outNote = card.querySelector("[data-tree-note]");

  var st, L = null, S = 3, raf = 0, runId = 0, touched = false;
  function fresh() {
    return {
      v: POINTS.map(function () { return null; }), // null | "checking" | "PASS" | "FAIL"
      sel: 5,
      shown: 6,          // how many points are on the trunk (cp-0007 joins on Bring back)
      found: false,
      branch: 0,         // 0..1 how much of the recovery branch is drawn
      copy: false,       // the recovery copy folder
      busy: false,
      scan: -1,          // index under the scanline
      scanT: 0,
      blink: -1,         // index blinking in
      log: []
    };
  }

  /* ---------- layout ---------- */
  function layout() {
    var w = Math.max(240, stage.clientWidth || card.clientWidth);
    S = w >= 900 ? 6 : w >= 600 ? 4 : 3;
    var W = Math.floor(w / S);
    var cssH = Math.max(168, Math.min(300, Math.round(w * 0.3)));
    var H = Math.floor(cssH / S);
    canvas.width = W; canvas.height = H;
    canvas.style.width = W * S + "px"; canvas.style.height = H * S + "px";
    nodesBox.style.width = W * S + "px"; nodesBox.style.height = H * S + "px";
    var mx = Math.max(6, Math.round(W * 0.07));
    var xs = POINTS.map(function (_, i) { return mx + Math.round(i * (W - 2 * mx) / 6); });
    var yT = Math.round(H * 0.66), yB = Math.round(H * 0.24);
    var dy = yT - 5 - yB;
    var leafX = Math.max(xs[4], xs[2] + dy + 8);
    // The branch, pixel by pixel: up the 45-degree stair from cp-0003, then across to the copy.
    var path = [];
    var x = xs[2], y = yT - 4;
    while (y > yB) { path.push([x, y]); x += 1; y -= 1; }
    while (x <= leafX - 7) { path.push([x, y]); x += 1; }
    L = { W: W, H: H, xs: xs, yT: yT, yB: yB, path: path, leafX: leafX };
    placeNodes();
  }

  /* ---------- drawing ---------- */
  function px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function outline(x, y, w, h, c) { rect(x, y, w, 1, c); rect(x, y + h - 1, w, 1, c); rect(x, y, 1, h, c); rect(x + w - 1, y, 1, h, c); }
  var CHECK = [[1, 3], [2, 4], [3, 3], [4, 2], [5, 1]];
  var CROSS = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [5, 1], [4, 2], [2, 4], [1, 5]];

  function drawNode(i, now) {
    var x = L.xs[i] - 3, y = L.yT - 3, v = st.v[i];
    if (st.blink === i && !reduced && Math.floor(now / 90) % 2) return;
    if (v === "PASS" || v === "FAIL") {
      rect(x, y, 7, 7, v === "PASS" ? C.works : C.broken);
      (v === "PASS" ? CHECK : CROSS).forEach(function (p) { px(x + p[0], y + p[1], C.paper); });
    } else {
      rect(x, y, 7, 7, C.paper);
      outline(x, y, 7, 7, v === "checking" ? C.ink : C.ink3);
      if (v === "checking" && (reduced || Math.floor(now / 120) % 2)) rect(x + 2, y + 2, 3, 3, C.ink);
    }
    if (st.sel === i) { // corner brackets
      var a = x - 2, b = y - 2, e = x + 8, f = y + 8;
      [[a, b, 1, 0], [a, b, 0, 1], [e, b, -1, 0], [e, b, 0, 1], [a, f, 1, 0], [a, f, 0, -1], [e, f, -1, 0], [e, f, 0, -1]].forEach(function (k) {
        px(k[0], k[1], C.ink); px(k[0] + k[2], k[1] + k[3], C.ink);
      });
    }
  }

  function drawFolder(x, y) { // 11 x 8, tab on the top left
    rect(x, y + 1, 11, 7, C.paper);
    rect(x, y, 4, 1, C.ink); px(x + 4, y + 1, C.ink);
    rect(x + 4, y + 1, 7, 1, C.ink);
    outline(x, y + 1, 11, 7, C.ink);
    rect(x + 2, y + 4, 5, 1, C.ink3);
  }

  function draw(now) {
    if (!L) return;
    ctx.clearRect(0, 0, L.W, L.H);
    rect(0, 0, L.W, L.H, C.paper);
    for (var gy = 2; gy < L.H; gy += 4) for (var gx = 2; gx < L.W; gx += 4) px(gx, gy, C.grid);
    // the trunk
    var last = L.xs[st.shown - 1];
    rect(L.xs[0] - 5, L.yT, last - L.xs[0] + 5, 1, C.ink);
    if (st.shown < 7) for (var d = 0; d < 6; d += 2) px(last + 4 + d, L.yT, C.ink3); // the trunk goes on: now
    // the recovery branch and its copy
    var n = Math.round(st.branch * L.path.length);
    for (var k = 0; k < n; k++) px(L.path[k][0], L.path[k][1], C.ink);
    if (st.copy) {
      var fx = L.leafX - 5, fy = L.yB - 4;
      if (!(st.blink === 99 && !reduced && Math.floor(now / 90) % 2)) drawFolder(fx, fy);
    }
    // the scanline over the point being checked
    if (st.scan >= 0 && !reduced) {
      var sx = L.xs[st.scan] - 5 + Math.floor(st.scanT * 11);
      for (var sy = L.yT - 7; sy <= L.yT + 7; sy++) if (sy % 2 === 0) px(sx, sy, C.ink);
    }
    for (var i = 0; i < st.shown; i++) drawNode(i, now);
  }

  function frame(now) {
    raf = 0;
    draw(now);
    if (st.busy || st.blink >= 0 || st.scan >= 0) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ---------- nodes as real buttons ---------- */
  var buttons = [];
  function buildNodes() {
    POINTS.forEach(function (p, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tnode";
      b.innerHTML = '<span aria-hidden="true">' + p.id.slice(3) + "</span>";
      b.addEventListener("click", function () { touched = true; select(i, true); });
      nodesBox.appendChild(b);
      buttons.push(b);
    });
  }
  function placeNodes() {
    buttons.forEach(function (b, i) {
      b.style.left = L.xs[i] * S + "px";
      b.style.top = (L.yT - 3) * S + "px";
      b.style.setProperty("--n", 7 * S + "px");
    });
  }
  function label(i) {
    var v = st.v[i];
    return POINTS[i].id + ", " + POINTS[i].note + ", " + (v === "PASS" ? WORD.PASS : v === "FAIL" ? WORD.FAIL : v === "checking" ? WORD.checking : WORD.none);
  }
  function syncNodes() {
    buttons.forEach(function (b, i) {
      b.hidden = i >= st.shown;
      b.tabIndex = i === st.sel ? 0 : -1;
      b.setAttribute("aria-pressed", String(i === st.sel));
      b.setAttribute("aria-label", label(i));
      b.dataset.v = st.v[i] || "none";
    });
  }
  function select(i, focus) {
    st.sel = Math.max(0, Math.min(st.shown - 1, i));
    var p = POINTS[st.sel], v = st.v[st.sel];
    outId.textContent = p.id;
    outVerdict.textContent = v === "PASS" ? WORD.PASS : v === "FAIL" ? WORD.FAIL : v === "checking" ? WORD.checking : WORD.none;
    outVerdict.dataset.v = v || "none";
    outNote.textContent = p.note;
    syncNodes();
    if (focus) buttons[st.sel].focus();
    kick();
  }

  /* ---------- the log ---------- */
  var LOG_MAX = 9;
  function renderLog() {
    var lines = st.log.slice(-LOG_MAX);
    // One child, so the flex column (bottom-anchored) keeps the spans inline.
    logEl.innerHTML = '<span class="tl">' + lines.map(function (l) {
      var t = l.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      t = t.replace(/^\$ /, '<span class="d">$</span> ').replace(/^# /, '<span class="d">#</span> ');
      return t.replace(/\b(PASS)\b/g, '<span class="p">$1</span>').replace(/\b(FAIL)\b/g, '<span class="f">$1</span>');
    }).join("\n") + (st.busy ? '<span class="cur"> </span>' : "") + "</span>";
  }
  function say(text) { status.textContent = text; }

  /** Types `text` as a new log line; resolves when done. Instant with reduced motion. */
  function type(text, my) {
    st.log.push("");
    var idx = st.log.length - 1;
    if (reduced) { st.log[idx] = text; renderLog(); return Promise.resolve(); }
    return new Promise(function (done) {
      var i = 0;
      (function step() {
        if (my !== runId) return done();
        i = Math.min(text.length, i + 3);
        st.log[idx] = text.slice(0, i);
        renderLog();
        if (i < text.length) setTimeout(step, 16); else done();
      })();
    });
  }
  function wait(ms, my) {
    return new Promise(function (done) { setTimeout(function () { done(my === runId); }, reduced ? 0 : ms); });
  }
  function animate(ms, fn, my) { // fn(t) for t in 0..1
    if (reduced) { fn(1); return Promise.resolve(); }
    return new Promise(function (done) {
      var t0 = performance.now();
      (function step(now) {
        if (my !== runId) return done();
        var t = Math.min(1, (now - t0) / ms);
        fn(t); kick();
        if (t < 1) requestAnimationFrame(step); else done();
      })(t0);
    });
  }
  function pad(id, v) { return "  " + id + "   " + (v + "    ").slice(0, 4) + "       " + (v === "PASS" ? "The check passed." : FAIL_LINE); }

  /* ---------- actions ---------- */
  function setButtons() {
    bFind.disabled = st.busy || st.found;
    bBack.disabled = st.busy || !st.found || st.branch > 0;
    bUndo.disabled = st.busy || !st.copy;
    bReset.disabled = st.busy;
  }
  function begin() { st.busy = true; setButtons(); renderLog(); kick(); return ++runId; }
  function end() { st.busy = false; setButtons(); renderLog(); kick(); }

  async function find() {
    if (st.busy || st.found) return;
    var my = begin();
    await type("$ tm find-good", my);
    for (var i = 5; i >= 2; i--) {
      if (my !== runId) return;
      st.v[i] = "checking"; st.scan = i; st.scanT = 0; select(i);
      say("Checking " + POINTS[i].id + ", " + POINTS[i].note + ".");
      await animate(820, function (t) { st.scanT = t; }, my);
      if (my !== runId) return;
      st.scan = -1; st.v[i] = POINTS[i].real; select(i);
      await type(pad(POINTS[i].id, POINTS[i].real), my);
    }
    st.found = true;
    await type("PASS  cp-0003 is the newest version that works.", my);
    await type("Next: tm recover cp-0003", my);
    if (my !== runId) return;
    say("cp-0003 passed. It is the newest version that works. Press R to bring it back.");
    end();
  }

  async function back() {
    if (st.busy || !st.found || st.branch > 0) return;
    var my = begin();
    select(2);
    await type("$ tm recover cp-0003", my);
    st.shown = 7; st.blink = 6; syncNodes(); select(6);
    say("Saved your current state first, as cp-0007.");
    await wait(540, my); st.blink = -1;
    say("Creating the branch tm/recover/cp-0003.");
    await animate(900, function (t) { st.branch = t; }, my);
    st.copy = true; st.blink = 99; kick();
    await wait(540, my); st.blink = -1;
    for (var k = 0; k < RECOVER_OUT.length; k++) await type(RECOVER_OUT[k], my);
    if (my !== runId) return;
    select(2);
    say("cp-0003 is back on the branch tm/recover/cp-0003, in a recovery copy next to the project. The project folder was not touched.");
    end();
  }

  async function undo() {
    if (st.busy || !st.copy) return;
    var my = begin();
    st.blink = 99; await wait(420, my); st.blink = -1; st.copy = false;
    await animate(600, function (t) { st.branch = 1 - t; }, my);
    st.branch = 0;
    await type("# Undo this rewind (web app): the copy and the branch are removed. Save points stay.", my);
    if (my !== runId) return;
    say("Undone. The recovery copy and the branch are removed. Save points stay, so cp-0007 is still there.");
    end();
  }

  function reset() {
    if (st.busy) return;
    runId++;
    st = fresh();
    select(5);
    setButtons(); renderLog(); say("Started over.");
  }

  /* ---------- keys and wiring ---------- */
  card.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var onNode = e.target.classList && e.target.classList.contains("tnode");
    if (onNode && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End")) {
      e.preventDefault(); touched = true;
      select(e.key === "Home" ? 0 : e.key === "End" ? st.shown - 1 : st.sel + (e.key === "ArrowLeft" ? -1 : 1), true);
      return;
    }
    var k = e.key.toLowerCase();
    var b = k === "f" ? bFind : k === "r" ? bBack : k === "z" ? bUndo : null;
    if (b && !b.disabled) { e.preventDefault(); touched = true; b.click(); }
  });
  bFind.addEventListener("click", function () { touched = true; find(); });
  bBack.addEventListener("click", function () { touched = true; back(); });
  bUndo.addEventListener("click", function () { touched = true; undo(); });
  bReset.addEventListener("click", function () { touched = true; reset(); });

  st = fresh();
  buildNodes();
  card.querySelector(".tree-static").hidden = true;
  nodesBox.hidden = false; read.hidden = false; acts.hidden = false; logEl.hidden = false;
  card.classList.add("live");
  layout(); select(5); setButtons(); renderLog(); draw(performance.now());
  if (window.ResizeObserver) new ResizeObserver(function () { layout(); draw(performance.now()); }).observe(card);

  // One unprompted moment: the first time the tree is half in view, it runs Find once.
  if (!reduced && window.IntersectionObserver) {
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      setTimeout(function () { if (!touched) find(); }, 500);
    }, { threshold: 0.5 });
    io.observe(card);
  }
})();
