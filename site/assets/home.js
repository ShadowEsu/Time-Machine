/* Time Machine landing page. No libraries. Every story frame is a pure function of scroll. */
(function () {
  "use strict";
  var root = document.documentElement;
  var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduce = mqReduce.matches;
  var hasIO = "IntersectionObserver" in window;
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* Springs, sampled into CSS linear() so a transition can follow them.
     Verdict stamp: stiffness 400, damping 30. Overlay card: stiffness 300, damping 32. */
  function springCurve(k, c, seconds, samples) {
    var x = 0, v = 0, dt = 1 / 1200, pts = [], next = 0, step = seconds / samples;
    for (var t = 0; t <= seconds + 1e-9; t += dt) {
      if (t >= next) { pts.push(+x.toFixed(4)); next += step; }
      var a = -k * (x - 1) - c * v;
      v += a * dt; x += v * dt;
    }
    pts[pts.length - 1] = 1;
    return "linear(" + pts.join(", ") + ")";
  }
  if (window.CSS && CSS.supports && CSS.supports("transition-timing-function", "linear(0, 1)")) {
    root.style.setProperty("--spring-verdict", springCurve(400, 30, 0.5, 40));
    root.style.setProperty("--spring-card", springCurve(300, 32, 0.55, 40));
  }

  /* Header hairline and reading progress */
  var top = document.getElementById("top");
  var bar = document.querySelector(".top-progress i");
  var headTick = false;
  function onHead() {
    headTick = false;
    var y = window.scrollY;
    top.classList.toggle("scrolled", y > 8);
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.transform = "scaleX(" + (max > 0 ? clamp(y / max, 0, 1) : 0).toFixed(4) + ")";
  }
  window.addEventListener("scroll", function () { if (!headTick) { headTick = true; requestAnimationFrame(onHead); } }, { passive: true });
  onHead();

  /* Headlines reveal by line. Words keep their own text, so screen readers read them normally. */
  function splitWords(el) {
    var walk = function (node, into) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          child.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { into.appendChild(document.createTextNode(" ")); return; }
            var w = document.createElement("span"); w.className = "w";
            var i = document.createElement("span"); i.textContent = part;
            w.appendChild(i); into.appendChild(w);
          });
        } else if (child.nodeType === 1) {
          var copy = child.cloneNode(false);
          walk(child, copy);
          into.appendChild(copy);
        }
      });
    };
    var frag = document.createDocumentFragment();
    walk(el, frag);
    el.textContent = "";
    el.appendChild(frag);
  }
  function lineDelays(el, base) {
    var words = el.querySelectorAll(".w");
    var lineTop = null, line = -1, inLine = 0;
    Array.prototype.forEach.call(words, function (w) {
      var t = w.offsetTop;
      if (lineTop === null || Math.abs(t - lineTop) > 4) { lineTop = t; line++; inLine = 0; }
      w.firstChild.style.setProperty("--d", Math.min(600, base + line * 110 + inLine * 30) + "ms");
      inLine++;
    });
  }
  function splitLetters(el) {
    var text = el.textContent;
    el.setAttribute("aria-label", text);
    var wrap = document.createElement("span");
    wrap.setAttribute("aria-hidden", "true");
    var n = 0;
    text.split("").forEach(function (ch) {
      if (ch === " ") { wrap.appendChild(document.createTextNode(" ")); return; }
      var s = document.createElement("span"); s.className = "ch"; s.textContent = ch;
      s.style.setProperty("--d", Math.min(500, n * 22) + "ms"); n++;
      wrap.appendChild(s);
    });
    el.textContent = "";
    el.appendChild(wrap);
    el.classList.add("letters");
  }

  var splits = Array.prototype.slice.call(document.querySelectorAll(".split"));
  var lettered = Array.prototype.slice.call(document.querySelectorAll(".fc h3, .ac h3"));
  if (!reduce) {
    splits.forEach(function (el) { splitWords(el); el.classList.add("armed"); });
    lettered.forEach(function (el) { splitLetters(el); el.classList.add("armed"); });
  }

  /* Load-in for the hero */
  var heroH = document.getElementById("hero-h");
  var readied = false;
  function ready() {
    if (readied) return; readied = true;
    if (!reduce && heroH) { lineDelays(heroH, 120); }
    root.classList.add("ready");
    if (heroH) requestAnimationFrame(function () { heroH.classList.add("in"); });
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(ready);
    setTimeout(ready, 900);
  } else { ready(); }

  /* Reveal once, at 15 percent into view */
  var revealables = Array.prototype.slice.call(document.querySelectorAll(".rv, .split, .letters"))
    .filter(function (el) { return el !== heroH; });
  if (hasIO && !reduce) {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        if (el.classList.contains("split")) lineDelays(el, 0);
        el.classList.add("in");
        rio.unobserve(el);
        setTimeout(function () { el.classList.add("settled"); }, 1400);
      });
    }, { rootMargin: "0px 0px -15% 0px" });
    revealables.forEach(function (el) { rio.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("in"); });
  }

  /* The story. One render function, driven by scroll when pinned, or by fixed values for stills. */
  var story = document.querySelector(".story");
  if (story) {
    var track = story.querySelector(".story-track");
    var stage = story.querySelector(".stage");
    var caps = Array.prototype.slice.call(story.querySelectorAll(".cap"));
    stage.classList.add("stage-orig");
    Array.prototype.forEach.call(stage.querySelectorAll(".tl-id"), function (b) {
      b.setAttribute("data-short", b.textContent.slice(-2));
    });

    var pairs = function (s) { return s.split(";").map(function (r) { return r.split(":").map(Number); }); };
    var prep = function (scope, stageEl) {
      return {
        stage: stageEl,
        items: Array.prototype.map.call(scope.querySelectorAll("[data-range]"), function (el) { return { el: el, r: pairs(el.getAttribute("data-range")), on: null }; }),
        steps: Array.prototype.map.call(scope.querySelectorAll("[data-steps]"), function (el) { return { el: el, s: pairs(el.getAttribute("data-steps")), v: null }; }),
        types: Array.prototype.map.call(scope.querySelectorAll("[data-type]"), function (el) {
          var ab = el.getAttribute("data-type").split(":").map(Number);
          return { el: el, a: ab[0], b: ab[1], full: el.getAttribute("data-full") || el.textContent, n: -1 };
        }),
        broken: null
      };
    };
    var render = function (sc, p) {
      sc.items.forEach(function (it) {
        var on = it.r.some(function (r) { return p >= r[0] && p < r[1]; });
        if (on !== it.on) { it.on = on; it.el.classList.toggle("on", on); }
      });
      sc.steps.forEach(function (st) {
        var v = st.s[0][1];
        st.s.forEach(function (s) { if (p >= s[0]) v = s[1]; });
        if (v !== st.v) { st.v = v; st.el.style.setProperty("--s", v); }
      });
      sc.types.forEach(function (ty) {
        var n = Math.round(clamp((p - ty.a) / (ty.b - ty.a), 0, 1) * ty.full.length);
        if (n !== ty.n) { ty.n = n; ty.el.textContent = ty.full.slice(0, n); }
      });
      var broken = p >= 0.36 && p < 0.8;
      if (broken !== sc.broken) { sc.broken = broken; sc.stage.classList.toggle("broken", broken); }
    };
    Array.prototype.forEach.call(stage.querySelectorAll("[data-type]"), function (el) { el.setAttribute("data-full", el.textContent); });

    var live = prep(story, stage);
    var mode = null, ticking = false;
    var progress = function () {
      var r = track.getBoundingClientRect();
      var total = r.height - window.innerHeight;
      return total > 0 ? clamp(-r.top / total, 0, 1) : 0;
    };
    var frame = function () { ticking = false; if (mode === "pinned") render(live, progress()); };
    var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };

    var buildStills = function () {
      caps.forEach(function (cap, i) {
        var clone = stage.cloneNode(true);
        clone.classList.remove("stage-orig");
        clone.classList.add("stage-still", "still-" + i);
        cap.appendChild(clone);
        render(prep(clone, clone), parseFloat(cap.getAttribute("data-still")));
      });
    };
    var removeStills = function () {
      Array.prototype.forEach.call(story.querySelectorAll(".stage-still"), function (el) { el.remove(); });
    };
    var wantPinned = function () { return !reduce && window.innerWidth > 860 && window.innerHeight >= 560; };
    var setMode = function () {
      var next = wantPinned() ? "pinned" : "stacked";
      if (next === mode) return;
      mode = next;
      story.classList.toggle("pinned", mode === "pinned");
      story.classList.toggle("stacked", mode === "stacked");
      if (mode === "stacked") {
        buildStills();
        caps.forEach(function (c) { c.classList.add("on"); });
      } else {
        removeStills();
        live = prep(story, stage);
        render(live, progress());
      }
    };
    setMode();
    window.addEventListener("scroll", onScroll, { passive: true });
    var rs;
    window.addEventListener("resize", function () { clearTimeout(rs); rs = setTimeout(function () { setMode(); onScroll(); }, 150); });

    Array.prototype.forEach.call(story.querySelectorAll(".chapters button"), function (b) {
      b.addEventListener("click", function () {
        var r = track.getBoundingClientRect();
        var y = window.scrollY + r.top + parseFloat(b.getAttribute("data-go")) * (r.height - window.innerHeight);
        window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
      });
    });
  }

  /* Try it: replays real tm demo output. Strings follow packages/cli/src/format.ts exactly. */
  var term = document.getElementById("term");
  var rewind = document.getElementById("rewind");
  var status = document.getElementById("try-status");
  if (term && rewind) {
    Array.prototype.slice.call(term.childNodes).forEach(function (n) { if (n.nodeType === 3 && !n.textContent.trim()) n.remove(); });
    var initial = term.innerHTML;
    var label = rewind.querySelector(".rewind-t");
    var miniDots = {};
    Array.prototype.forEach.call(document.querySelectorAll(".mini-tl span"), function (s) { miniDots[s.getAttribute("data-cp")] = s; });
    var branch = document.querySelector(".mini-branch");
    var esc = function (s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
    var pad = function (s, n) { return s + Array(Math.max(0, n - s.length) + 1).join(" "); };
    var tried = [["cp-0006", "FAIL", "The check failed with exit code 1."], ["cp-0005", "FAIL", "The check failed with exit code 1."], ["cp-0004", "FAIL", "The check failed with exit code 1."], ["cp-0003", "PASS", "The check passed."]];
    var vspan = function (v, text) { return '<span class="' + (v === "PASS" ? "t-pass" : "t-fail") + '">' + esc(text) + "</span>"; };
    var recover = [
      "Recovery ready for cp-0003. Nothing was pushed, merged or deployed. Your folder and branch were not touched.",
      '  <span class="dim">Branch</span>          tm/recover/cp-0003',
      '  <span class="dim">Recovery copy</span>   /tmp/tm-demo/marigold-tips-recovered-cp-0003',
      '  <span class="dim">Saved first</span>     cp-0007, your state before this recovery',
      '  <span class="dim">Last check</span>      PASS',
      "Restored", "  Code at commit 51bb798", "  1 saved file",
      "Not restored", "  Secret values in .env: PORT, STRIPE_SECRET_KEY", "  Databases, deployed versions and external services are not captured",
      "Manual steps", "  Set PORT in .env in the recovery copy.", "  Set STRIPE_SECRET_KEY in .env in the recovery copy.",
      "  Review the recovery copy at /tmp/tm-demo/marigold-tips-recovered-cp-0003."
    ];
    var cursor = document.createElement("span"); cursor.className = "cur";
    var addLine = function (html) {
      var ln = document.createElement("span");
      ln.className = "ln new";
      ln.innerHTML = html;
      term.appendChild(ln);
      ln.appendChild(cursor);
      term.scrollTop = term.scrollHeight;
      return ln;
    };
    var typeCmd = async function (cmd) {
      var ln = addLine('<span class="ps">$ </span><span class="tx"></span>');
      var tx = ln.querySelector(".tx");
      if (reduce) { tx.textContent = cmd; return; }
      await wait(350);
      for (var i = 1; i <= cmd.length; i++) { tx.textContent = cmd.slice(0, i); await wait(28); }
      await wait(260);
    };
    var resetMini = function () {
      Object.keys(miniDots).forEach(function (k) { miniDots[k].className = ""; });
      branch.classList.remove("on");
    };
    var playing = false, played = false;
    var play = async function () {
      if (playing) return;
      playing = true;
      rewind.disabled = true;
      label.textContent = "Rewinding";
      if (played) { term.innerHTML = initial; resetMini(); }
      addLine("");
      status.textContent = "Checking save points in a separate copy, newest first.";
      await typeCmd("tm find-good");
      for (var i = 0; i < tried.length; i++) {
        var t = tried[i], dot = miniDots[t[0]];
        if (!reduce) { dot.className = "scan"; await wait(420); }
        dot.className = t[1] === "PASS" ? "pass" : "fail";
        addLine("  " + pad(t[0], 9) + " " + vspan(t[1], pad(t[1], 10)) + " " + esc(t[2]));
      }
      if (!reduce) await wait(220);
      addLine(vspan("PASS", "PASS") + "  cp-0003 is the newest version that works.");
      addLine('<span class="dim">Next:</span> tm recover cp-0003');
      status.textContent = "cp-0003 is the newest version that works.";
      addLine("");
      if (!reduce) await wait(500);
      await typeCmd("tm recover cp-0003");
      if (!reduce) await wait(300);
      for (var j = 0; j < recover.length; j++) {
        addLine(recover[j]);
        if (j === 1) branch.classList.add("on");
        if (!reduce) await wait(j === 0 ? 260 : 70);
      }
      status.textContent = "Recovery ready on branch tm/recover/cp-0003. Your folder and branch were not touched. Secret values are set again by hand.";
      playing = false; played = true;
      rewind.disabled = false;
      label.textContent = "Replay";
    };
    rewind.addEventListener("click", play);
  }

  /* Agents flow: prompt, save point, agent turn, check, wake on PASS to FAIL */
  var flow = document.querySelector(".flow");
  if (flow) {
    var nodes = flow.querySelectorAll(".flow-steps li");
    var pulse = flow.querySelector(".flow-pulse");
    var setLit = function (n) {
      for (var k = 0; k < 5; k++) flow.classList.remove("lit-" + k);
      if (n >= 0) flow.classList.add("lit-" + n);
    };
    var movePulse = function (n) {
      if (!pulse || !nodes[n]) return;
      var f = flow.getBoundingClientRect(), r = nodes[n].getBoundingClientRect();
      pulse.style.transform = "translate(" + (r.left - f.left + r.width / 2).toFixed(1) + "px," + (r.top - f.top + 9.5).toFixed(1) + "px)";
    };
    if (reduce || !hasIO) { setLit(4); }
    else {
      var loopOn = false, timer = null, n = -1;
      var stepFlow = function () {
        n = n >= 4 ? -1 : n + 1;
        setLit(n);
        if (n >= 0) { movePulse(n); pulse.style.opacity = "1"; } else { pulse.style.opacity = "0"; }
        timer = setTimeout(stepFlow, n === 4 ? 2600 : n === -1 ? 700 : 950);
      };
      new IntersectionObserver(function (es) {
        var vis = es.some(function (e) { return e.isIntersecting; });
        if (vis && !loopOn) { loopOn = true; stepFlow(); }
        else if (!vis && loopOn) { loopOn = false; clearTimeout(timer); }
      }, { threshold: 0.3 }).observe(flow);
    }
  }

  /* Copy buttons */
  var copyStatus = document.getElementById("copy-status");
  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (b) {
    b.setAttribute("aria-label", "Copy " + b.getAttribute("data-copy"));
    b.addEventListener("click", function () {
      var text = b.getAttribute("data-copy");
      var done = function (ok) {
        b.textContent = ok ? "Copied" : "Select it";
        if (copyStatus) copyStatus.textContent = ok ? "Copied " + text : "Copy failed. Select the text instead.";
        setTimeout(function () { b.textContent = "Copy"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
  });

  /* Waitlist. No backend yet: with an empty endpoint we say so and never fake success. */
  var form = document.getElementById("waitlist");
  if (form) {
    var note = document.getElementById("wl-note");
    var email = document.getElementById("wl-email");
    var consent = document.getElementById("wl-consent");
    var button = form.querySelector("button[type=submit]");
    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (!email.checkValidity() || !email.value.trim()) { note.textContent = "Please enter a valid email address."; email.focus(); return; }
      if (!consent.checked) { note.textContent = "Please tick the box so we can email you."; consent.focus(); return; }
      var endpoint = (form.getAttribute("data-endpoint") || "").trim();
      if (!endpoint) { note.textContent = "The waitlist opens soon."; return; }
      button.disabled = true;
      note.textContent = "Sending.";
      try {
        var res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.value.trim(), consent: true }) });
        note.textContent = res.ok ? "Thanks. You are on the list." : "That did not go through. Please try again later.";
      } catch (err) {
        note.textContent = "That did not go through. Please try again later.";
      } finally {
        button.disabled = false;
      }
    });
  }
})();
