/* Home's 3D machine, the loader (deferred). Runs only in motion mode (html.motion, set before paint by the head
   script: JavaScript runs, motion is allowed, the device isn't weak, a phone viewport is tall enough).
   1. Layout: the stage's height goes on it as --h (s5.css sticks it once its bottom reaches the screen's). On phones
      the machine sits under the hero; that offset goes on canvas#machine as data-dy (CSS px) for the scene.
   2. The poster (the scene's first frame, p = 0) is drawn into canvas#poster after the first LCP entry, scroll or
      load, never competing with the hero's text and fonts, scaled like the scene's camera to match its first frame.
   3. machine.js (three.js) loads after the first LCP entry, scroll or load + 1.5 s, fades in, removes the poster.
   4. No WebGL 2, a software renderer (SwiftShader, llvmpipe, WARP: seconds of main-thread work), a failed load or
      a lost context: html.motion goes and the page shows the stills.
   Reads only the GL renderer's name (no URL, storage or cookies) and sends nothing. */
(function () {
  var d = document.documentElement;
  if (!d.classList.contains("motion")) return;
  function stills() { d.classList.remove("motion"); }
  if (!window.WebGL2RenderingContext) return stills();

  var stage = document.querySelector(".pin .stage"), hero = document.querySelector("[data-hero]");
  var poster = document.getElementById("poster"), machine = document.getElementById("machine");
  var phone = matchMedia("(max-width: 640px)").matches;
  // Where the scene centres the machine (a fraction of the width) and, on phones, its top at p = 0 with no offset (of
  // the height; capture.py measures it). s5.css frames the no-motion poster <img> with the same AX, TOP and GAP.
  var AX = phone ? 0.5 : 0.67, TOP = 0.335, GAP = 20;

  function layout() {
    var h = machine.clientHeight;
    stage.style.setProperty("--h", stage.offsetHeight + "px");
    var dy = phone ? Math.round(Math.max(0.27 * h, hero.offsetTop + hero.offsetHeight - machine.offsetTop + GAP - TOP * h)) : 0;
    if (machine.dataset.dy !== String(dy)) {
      machine.dataset.dy = String(dy);
      machine.dispatchEvent(new Event("layout"));
    }
    return dy;
  }

  var img = new Image();
  img.decoding = "async";
  function draw() {
    var dy = layout();
    if (!img.naturalWidth || !poster.isConnected || machine.classList.contains("on")) return;
    var r = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(poster.clientWidth * r), h = Math.round(poster.clientHeight * r);
    if (!w || !h) return;
    // The image's height maps to the stage's (the camera's vertical field of view is fixed), its AX point to the stage's.
    var s = h / img.naturalHeight;
    if (poster.width !== w || poster.height !== h) { poster.width = w; poster.height = h; }
    var x = poster.getContext("2d");
    x.clearRect(0, 0, w, h);
    x.drawImage(img, AX * (w - img.naturalWidth * s), dy * r, img.naturalWidth * s, h);
    poster.classList.add("on");
  }
  img.onload = draw;
  new ResizeObserver(draw).observe(stage);
  new ResizeObserver(draw).observe(hero);

  var shown = false, started = false;
  function show() {
    if (shown) return;
    shown = true;
    img.src = phone ? "assets/img/s5/stack-390-poster.webp" : "assets/img/s5/stack-1440-poster.webp";
  }
  function go() {
    if (started) return;
    started = true;
    // A throwaway context, released at once: a software renderer or a performance caveat means stills.
    try {
      var g = document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true }), r = g.getParameter(g.RENDERER), x = /webkit/i.test(r) && g.getExtension("WEBGL_debug_renderer_info");
      if (x) r = g.getParameter(x.UNMASKED_RENDERER_WEBGL);
      (x = g.getExtension("WEBGL_lose_context")) && x.loseContext();
    } catch (e) { return stills(); }
    if (/swiftshader|llvmpipe|software|basic render/i.test(r)) return stills();
    show();
    machine.addEventListener("webglcontextlost", stills, { once: true });
    import("./machine.js").catch(stills);
  }
  try {
    new PerformanceObserver(function () { setTimeout(go, 0); }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) { /* no LCP API: scroll or load starts both */ }
  addEventListener("scroll", go, { passive: true, once: true });
  function loaded() { show(); setTimeout(go, 1500); }
  if (document.readyState === "complete") loaded();
  else addEventListener("load", loaded, { once: true });
})();
