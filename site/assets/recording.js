/* The real recovery recording: chapters next to the video.
   Each chapter is one caption cue, so the list is also the full transcript.
   Pressing a chapter plays the video from that cue and, when the video is out of
   sight (the chapters sit below it on phones), scrolls it into view under the
   sticky bar. While it plays, the current chapter is marked with aria-current and
   a thin bar shows progress through it.
   No autoplay; the video still loads nothing until the visitor presses play. */
(function () {
  "use strict";
  var section = document.getElementById("app-recording");
  if (!section) return;
  var video = section.querySelector("video");
  var buttons = section.querySelectorAll("[data-seek]");
  if (!video || !buttons.length) return;
  var current = -1;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function reveal() {
    var r = video.getBoundingClientRect();
    var top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (r.top >= top && r.bottom <= window.innerHeight) return;
    video.scrollIntoView({ block: "nearest", behavior: reduce.matches ? "instant" : "smooth" });
  }

  function playFrom(time) {
    var start = function () {
      video.currentTime = time;
      var playing = video.play();
      if (playing && playing.catch) playing.catch(function () { /* The visitor can still use the native controls. */ });
    };
    if (video.readyState >= 1) start();
    else {
      video.addEventListener("loadedmetadata", start, { once: true });
      video.preload = "metadata";
      video.load();
    }
  }

  function mark() {
    var t = video.currentTime;
    var index = -1;
    for (var i = 0; i < buttons.length; i++) if (t >= Number(buttons[i].dataset.seek) - 0.05) index = i;
    if (index !== current) {
      if (current >= 0) { buttons[current].removeAttribute("aria-current"); buttons[current].style.removeProperty("--p"); }
      if (index >= 0) buttons[index].setAttribute("aria-current", "true");
      current = index;
    }
    if (index >= 0) {
      var from = Number(buttons[index].dataset.seek), to = Number(buttons[index].dataset.end);
      buttons[index].style.setProperty("--p", Math.min(1, Math.max(0, (t - from) / (to - from))).toFixed(3));
    }
  }

  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function () { reveal(); playFrom(Number(this.dataset.seek)); });
  }
  video.addEventListener("timeupdate", mark);
  video.addEventListener("seeked", mark);
})();
