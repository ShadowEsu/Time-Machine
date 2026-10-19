/* Home-page instrument: an illustration using the real tm demo's checkpoint verdicts.
   No engine/network calls. Finite playback stops at the break; the visitor chooses the recovery. */
(function () {
  "use strict";
  var story = document.querySelector("[data-rewind]");
  if (!story) return;
  var dial = story.querySelector("[data-story-dial]");
  var recoverButtons = story.querySelectorAll("[data-story-recover]");
  var rewind = story.querySelector("[data-story-rewind]");
  var play = story.querySelector("[data-story-play]");
  var app = story.querySelector(".rs-app");
  var scene = story.querySelector(".rs-scene");
  var views = story.querySelectorAll("[data-story-view]");
  var appDetail = story.querySelector(".rs-app-detail");
  var rendered = "";
  var status = story.querySelector("[data-story-status]");
  var media = matchMedia("(prefers-reduced-motion: reduce)");
  var checkpoints = [
    { id: "cp-0001", note: "Initial tip calculator", verdict: null },
    { id: "cp-0002", note: "Added split bill", verdict: null },
    { id: "cp-0003", note: "Added dark mode", verdict: "PASS" },
    { id: "cp-0004", note: "Agent: fixed lint warnings", verdict: "FAIL" },
    { id: "cp-0005", note: "Changed currency", verdict: "FAIL" },
    { id: "cp-0006", note: "Added a dependency", verdict: "FAIL" }
  ];
  var appPoints = story.querySelector("[data-app-points]");
  checkpoints.forEach(function (cp, index) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-story-point", String(index));
    button.setAttribute("data-verdict", cp.verdict ? cp.verdict.toLowerCase() : "unchecked");
    var label = document.createElement("span");
    label.textContent = cp.note;
    var verdict = document.createElement("small");
    verdict.textContent = cp.verdict === "PASS" ? "Passed" : cp.verdict === "FAIL" ? "Failed" : "Not checked";
    button.append(label, verdict);
    appPoints.appendChild(button);
  });
  var points = story.querySelectorAll("[data-story-point]");
  var selected = 5;
  var recovered = false;
  var timer = 0;
  var running = false;
  var interacted = false;
  var autoPlayed = false;
  var drag = null;

  function text(selector, value) { story.querySelector(selector).textContent = value; }
  function word(cp) { return cp.verdict === "PASS" ? "tests passed" : cp.verdict === "FAIL" ? "tests failed" : "not checked"; }
  function reduced() { return media.matches || document.documentElement.dataset.tier === "low"; }
  function positionHead() {
    var line = story.querySelector(".rs-screen-line");
    story.style.setProperty("--rs-head", ((selected / 5 - 1) * line.clientWidth) + "px");
  }
  function draw(announce, setup) {
    var cp = checkpoints[selected];
    var passed = cp.verdict === "PASS";
    var phase = recovered ? "recovered" : passed ? "passed" : cp.verdict ? "broken" : "unchecked";
    story.setAttribute("data-phase", phase);
    story.style.setProperty("--rs-angle", (-135 + selected * 54) + "deg");
    dial.setAttribute("aria-valuenow", String(selected + 1));
    dial.setAttribute("aria-valuetext", cp.id + ", " + cp.note + ", " + word(cp));
    for (var i = 0; i < points.length; i++) points[i].setAttribute("aria-pressed", String(Number(points[i].getAttribute("data-story-point")) === selected));
    text("[data-story-id]", cp.id);
    text("[data-story-note]", cp.note);
    text("[data-story-verdict]", cp.verdict || "SAVED");
    text("[data-story-check]", passed ? "The check passed." : cp.verdict ? "The check failed with exit code 1." : "No check recorded. No verdict assumed.");
    text("[data-story-lamp]", recovered ? "Recovery copy ready" : word(cp));
    text("[data-story-step]", recovered ? "3 / A separate copy" : setup ? "Before the change" : passed || !cp.verdict || selected < 5 ? "2 / Turn back" : "1 / The break");
    text("#rs-title", recovered ? "Bring it back.\nKeep your work." : setup ? "Your tests passed.\nThen the agent kept going." : passed ? "This version\npassed its tests." : !cp.verdict ? "Saved, but\nnot checked yet." : selected < 5 ? "Not this version.\nKeep turning back." : "It worked.\nThen it broke.");
    text("[data-story-description]", recovered ? "In the real app, the passing version comes back on a new branch, in a separate copy. Your current folder stays as it is." : setup ? "Dark mode is saved as cp-0003. Then more changes arrive, each with its own save point." : passed ? "You found cp-0003, the newest save point that passed in this demo. Bring it back as a separate copy." : !cp.verdict ? "This save point has no recorded check. Time Machine never calls an unchecked version working." : "This save point fails its tests. Turn back through the changes to find the newest one that passed.");
    recoverButtons.forEach(function (button) {
      button.disabled = !passed;
      button.firstChild.textContent = recovered ? "Start again " : "Bring back this version ";
    });
    text("[data-app-id]", cp.id);
    text("[data-app-note]", recovered ? "Your separate copy is ready." : cp.note);
    text("[data-app-verdict]", recovered ? "Recovery illustrated" : word(cp));
    text("[data-app-check]", passed ? "The recorded check passed." : cp.verdict ? "The recorded check failed with exit code 1." : "No check recorded. No verdict assumed.");
    text("[data-app-heading]", recovered ? "Your current folder is unchanged" : "Before you bring it back");
    text("[data-app-summary]", recovered ? "In the real app, cp-0003 comes back in a separate copy on branch tm/recover/cp-0003." : passed ? "Bring cp-0003 back on a new branch, in a separate copy." : "Find a passing save point to review a recovery.");
    text("#rs-help", app.hidden ? "Drag the dial, use its arrow keys, or pick a save point below." : "Choose a save point in the app. Review its check, then bring back the passing version.");
    var nextRendered = selected + ":" + recovered;
    if (!app.hidden && rendered !== nextRendered && !reduced()) {
      appDetail.getAnimations().forEach(function (animation) { animation.cancel(); });
      appDetail.animate([{ opacity: .35, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(.22, 1, .36, 1)" });
    }
    rendered = nextRendered;
    positionHead();
    if (announce) status.textContent = recovered ? "Illustration: cp-0003 is back on a new branch in a separate copy. The current folder stays untouched." : cp.id + ", " + cp.note + ", " + word(cp) + (passed ? ". Bring back this version is now available." : ".");
  }
  function stop(manual) {
    clearTimeout(timer);
    running = false;
    play.textContent = "Play the story";
    if (manual) interacted = true;
  }
  function select(index, announce) {
    selected = Math.max(0, Math.min(5, index));
    recovered = false;
    draw(announce, false);
  }
  function userSelect(index) { stop(true); select(index, true); }
  function playStory() {
    if (running) return stop(true);
    stop(false);
    interacted = true;
    recovered = false;
    if (reduced()) { select(5, true); return; }
    running = true;
    play.textContent = "Pause the story";
    selected = 2;
    draw(false, true);
    var frame = 0;
    function next() {
      select([3, 4, 5][frame], false);
      frame++;
      if (frame < 3) timer = setTimeout(next, 650);
      else stop(false);
    }
    timer = setTimeout(next, 1250);
  }

  for (var i = 0; i < points.length; i++) {
    var checkpoint = checkpoints[Number(points[i].getAttribute("data-story-point"))];
    points[i].setAttribute("aria-label", checkpoint.id + ", " + checkpoint.note + ", " + word(checkpoint));
    points[i].addEventListener("click", function () { userSelect(Number(this.getAttribute("data-story-point"))); });
  }
  play.addEventListener("click", playStory);
  rewind.addEventListener("click", function () {
    stop(true);
    if (reduced() || selected <= 2) return select(2, true);
    running = true;
    play.textContent = "Pause the story";
    function back() {
      select(selected - 1, false);
      if (selected > 2) timer = setTimeout(back, 420);
      else { stop(false); draw(true, false); }
    }
    back();
  });
  recoverButtons.forEach(function (button) { button.addEventListener("click", function () {
    stop(true);
    if (recovered) return select(5, true);
    if (checkpoints[selected].verdict !== "PASS") return;
    recovered = true;
    draw(true, false);
  }); });
  dial.addEventListener("keydown", function (e) {
    var step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (step) userSelect(selected + step);
    else if (e.key === "Home") userSelect(0);
    else if (e.key === "End") userSelect(5);
    else return;
    e.preventDefault();
  });
  dial.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    stop(true);
    var box = dial.getBoundingClientRect();
    drag = { id: e.pointerId, x: box.left + box.width / 2, y: box.top + box.height / 2, angle: -135 + selected * 54 };
    drag.last = Math.atan2(e.clientY - drag.y, e.clientX - drag.x);
    dial.setPointerCapture(e.pointerId);
    dial.focus({ preventScroll: true });
    e.preventDefault();
  });
  dial.addEventListener("pointermove", function (e) {
    if (!drag || drag.id !== e.pointerId) return;
    var angle = Math.atan2(e.clientY - drag.y, e.clientX - drag.x);
    var delta = angle - drag.last;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    drag.angle = Math.max(-135, Math.min(135, drag.angle + delta * 180 / Math.PI));
    drag.last = angle;
    var next = Math.round((drag.angle + 135) / 54);
    if (next !== selected) select(next, false);
  });
  function endDrag(e) {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    if (dial.hasPointerCapture(e.pointerId)) dial.releasePointerCapture(e.pointerId);
    draw(true, false);
  }
  dial.addEventListener("pointerup", endDrag);
  dial.addEventListener("pointercancel", endDrag);
  dial.addEventListener("lostpointercapture", function () { drag = null; });
  function setView(view) {
    stop(true);
    var isApp = view === "app";
    app.hidden = !isApp;
    scene.hidden = isApp;
    story.dataset.view = view;
    views.forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.storyView === view)); });
    draw(false, false);
  }
  views.forEach(function (button) { button.addEventListener("click", function () { setView(button.dataset.storyView); }); });
  var openApp = document.querySelector("[data-open-app]");
  openApp.addEventListener("click", function (event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setView("app");
    if (location.hash !== "#rewind-demo") history.pushState(null, "", "#rewind-demo");
    story.scrollIntoView({ block: "start", behavior: "instant" });
    appPoints.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
  });
  openApp.hidden = false;
  story.querySelector(".rs-views").hidden = false;
  media.addEventListener("change", function () {
    stop(false);
    appDetail.getAnimations().forEach(function (animation) { animation.cancel(); });
    draw(false, false);
  });
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(false); });
  if ("ResizeObserver" in window) new ResizeObserver(positionHead).observe(story.querySelector(".rs-screen-line"));
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      var visible = entries[0].isIntersecting;
      if (!visible) stop(false);
      else if (!autoPlayed && !interacted && !media.matches && document.documentElement.dataset.tier !== "low" && !document.hidden) {
        autoPlayed = true;
        playStory();
      }
    }, { threshold: 0.4 }).observe(story);
  }
  dial.tabIndex = 0;
  dial.removeAttribute("aria-disabled");
  story.querySelector(".rs-controls").hidden = false;
  draw(false, false);
})();
