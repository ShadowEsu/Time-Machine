/* Typing and small premium touches. Reduced motion: none of this runs and the text is plain.
   [data-type]            types its text character by character with a caret when it comes into view.
   [data-type="term"]     types like a terminal: commands key in, output lines appear one by one.
   [data-type-now]        types as soon as the opening screen leaves (or right away if there is none).
   .card, .shot           a soft light follows the pointer (fine pointers only).
   .ft-word               a light sweeps across the wordmark once, when it comes into view.
   Text stays in the page the whole time, so search engines and screen readers read it as written. */
(function () {
  "use strict";
  var root = document.documentElement;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  /** Wraps every character of el's text in a span. Elements like <em> and <code> are kept. */
  function split(el) {
    var chars = [];
    (function walk(node) {
      for (var c = node.firstChild; c; ) {
        var next = c.nextSibling;
        if (c.nodeType === 3 && c.nodeValue.length) {
          var frag = document.createDocumentFragment();
          for (var i = 0; i < c.nodeValue.length; i++) {
            var s = document.createElement("span");
            s.className = "tw-c";
            s.textContent = c.nodeValue[i];
            frag.appendChild(s);
            chars.push(s);
          }
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== "BR") {
          walk(c);
        }
        c = next;
      }
    })(el);
    return chars;
  }

  /** Reveals chars at `speed` ms each with a caret on the newest one. Calls done(), keeps the caret `hold` ms. */
  function typeChars(chars, speed, hold, done) {
    var i = 0, last = null, t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var n = Math.min(chars.length, Math.floor((ts - t0) / speed) + 1);
      while (i < n) chars[i++].classList.add("on");
      if (last) last.classList.remove("tw-caret");
      last = chars[i - 1] || null;
      if (last) last.classList.add("tw-caret");
      if (i < chars.length) return requestAnimationFrame(step);
      setTimeout(function () {
        if (last) last.classList.remove("tw-caret");
        if (done) done();
      }, hold);
    }
    if (!chars.length) { if (done) done(); return; }
    requestAnimationFrame(step);
  }

  var SPEED = { H1: 30, H2: 22, H3: 24 };
  function prepText(el) {
    if (/^H[1-6]$/.test(el.tagName) && !el.hasAttribute("aria-label")) {
      var copy = el.cloneNode(true);
      var brs = copy.querySelectorAll("br");
      for (var b = 0; b < brs.length; b++) brs[b].replaceWith(" ");
      el.setAttribute("aria-label", copy.textContent.replace(/\s+/g, " ").trim());
    }
    var chars = split(el);
    el.classList.add("tw");
    return function play() {
      typeChars(chars, Number(el.getAttribute("data-speed")) || SPEED[el.tagName] || 26, 1100, function () { el.classList.add("tw-done"); });
    };
  }

  function prepTerm(pre) {
    var lines = pre.innerHTML.split("\n");
    pre.innerHTML = lines.map(function (h) { return '<span class="tl">' + h + "</span>"; }).join("\n");
    pre.classList.add("tw", "tw-term");
    var spans = pre.querySelectorAll(".tl");
    var plan = [];
    for (var i = 0; i < spans.length; i++) {
      var isCommand = /^\s*\$/.test(spans[i].textContent);
      plan.push({ line: spans[i], chars: isCommand ? split(spans[i]) : null });
    }
    return function play() {
      var k = 0;
      (function next() {
        if (k >= plan.length) { pre.classList.add("tw-done"); return; }
        var p = plan[k++];
        p.line.classList.add("on");
        if (p.chars) typeChars(p.chars, 34, 260, next);
        else setTimeout(next, p.line.textContent.trim() ? 70 : 160);
      })();
    };
  }

  function prep(el) {
    return el.getAttribute("data-type") === "term" ? prepTerm(el) : prepText(el);
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Everything that types now, then everything that types on scroll.
    var now = document.querySelectorAll("[data-type-now]");
    var plays = [];
    for (var i = 0; i < now.length; i++) plays.push(prep(now[i]));
    var startNow = function () { for (var j = 0; j < plays.length; j++) plays[j](); };
    var intro = document.querySelector(".intro-word[data-type]");
    if (intro && root.getAttribute("data-intro") === "play") prep(intro)();
    if (root.getAttribute("data-intro") === "play") document.addEventListener("tm:intro-end", function () { setTimeout(startNow, 260); }, { once: true });
    else startNow();

    var later = document.querySelectorAll("[data-type]:not([data-type-now]):not(.intro-word)");
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (!entries[e].isIntersecting) continue;
          io.unobserve(entries[e].target);
          entries[e].target.__play();
        }
      }, { rootMargin: "0px 0px -12% 0px", threshold: 0.2 });
      for (var k = 0; k < later.length; k++) { later[k].__play = prep(later[k]); io.observe(later[k]); }
    }

    // Pointer light on cards and screenshots.
    if (matchMedia("(hover: hover) and (pointer: fine)").matches && root.dataset.tier !== "low") {
      var lit = document.querySelectorAll(".card, .shot");
      for (var m = 0; m < lit.length; m++) {
        lit[m].addEventListener("pointermove", function (ev) {
          var r = this.getBoundingClientRect();
          this.style.setProperty("--mx", (ev.clientX - r.left) + "px");
          this.style.setProperty("--my", (ev.clientY - r.top) + "px");
        });
      }
    }

    // One light sweep across the footer wordmark.
    var word = document.querySelector(".ft-word");
    if (word && "IntersectionObserver" in window) {
      var wo = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        word.classList.add("sweep");
        word.addEventListener("animationend", function () { word.classList.remove("sweep"); }, { once: true });
        wo.disconnect();
      }, { threshold: 0.4 });
      wo.observe(word);
    }
  });
})();
