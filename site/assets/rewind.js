/* Rewind replay under the hero. Steps back through the save points of a real `tm demo` run,
   checks each one (FAIL, FAIL, FAIL, PASS) and lands on the newest version that passes.
   Plays once after the headline finishes typing, then the button replays it.
   Reduced motion: the button jumps straight to the result. */
(function () {
  "use strict";
  var fig = document.querySelector("[data-rewind]");
  if (!fig) return;
  var dots = fig.querySelectorAll(".rw-line li");
  var out = fig.querySelector(".rw-out");
  var btn = fig.querySelector(".rw-go");
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var NOTES = {
    "cp-0006": "Added a dependency", "cp-0005": "Changed currency", "cp-0004": "Agent: fixed lint warnings",
    "cp-0003": "Added dark mode"
  };
  var timer = 0;

  function say(cp, text) {
    out.textContent = "";
    var c = document.createElement("code");
    c.textContent = cp;
    out.appendChild(c);
    out.appendChild(document.createTextNode(" " + text));
  }

  function reset() {
    for (var i = 0; i < dots.length; i++) { dots[i].classList.remove("checked", "head", "back"); }
    dots[dots.length - 1].classList.add("head");
    fig.classList.remove("done");
    say("cp-0006", "Added a dependency. Your tests fail.");
  }

  function finish() {
    for (var i = 0; i < dots.length; i++) {
      var v = dots[i].getAttribute("data-v");
      dots[i].classList.toggle("checked", Boolean(v));
      dots[i].classList.toggle("head", dots[i].getAttribute("data-cp") === "cp-0003");
    }
    fig.classList.add("done");
    say("cp-0003", "passes. Back on a new branch, tm/recover/cp-0003. Your folder was not touched.");
    btn.textContent = "Replay";
  }

  function play() {
    clearTimeout(timer);
    if (reduced) return finish();
    reset();
    btn.textContent = "Rewinding\u2026";
    var order = ["cp-0006", "cp-0005", "cp-0004", "cp-0003"];
    var k = 0;
    (function step() {
      var cp = order[k];
      var li = fig.querySelector('[data-cp="' + cp + '"]');
      for (var i = 0; i < dots.length; i++) dots[i].classList.remove("head");
      li.classList.add("head", "checked");
      var pass = li.getAttribute("data-v") === "pass";
      if (pass) return void (timer = setTimeout(finish, 650));
      say(cp, NOTES[cp] + ". Check failed, exit code 1.");
      k++;
      timer = setTimeout(step, 620);
    })();
  }

  btn.addEventListener("click", play);
  if (reduced) return;
  // Play once, after the headline has typed (or right away when nothing types).
  var h1 = document.querySelector("#hero-h");
  var started = false;
  function auto() { if (!started) { started = true; timer = setTimeout(play, 400); } }
  if (h1 && h1.hasAttribute("data-type")) {
    var mo = new MutationObserver(function () { if (h1.classList.contains("tw-done")) { mo.disconnect(); auto(); } });
    mo.observe(h1, { attributes: true, attributeFilter: ["class"] });
    setTimeout(auto, 6000);
  } else auto();
})();
