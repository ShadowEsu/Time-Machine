/* Home's 3D machine, the loader (deferred). Runs only in motion mode: html.motion is set before paint by the head
   script when JavaScript runs, motion is allowed, the device isn't weak, and a phone viewport is tall enough.
   1. Layout: on phones the machine sits under the hero (the waitlist form makes it tall). The offset goes on
      canvas#machine as data-dy (CSS px) for the scene, and is re-measured when the hero or the stage resizes.
   2. The poster: the scene's first frame (p = 0), drawn into canvas#poster under the 3D canvas, and faded in. It is
      requested after the first LCP entry, the first scroll, or load, whichever comes first, so it never competes
      with the hero's text and fonts. The files are captured with no offset; they are drawn the way the scene's
      camera scales (with the stage height, anchored where the scene centres the machine), so the poster and the
      first 3D frame match at any viewport size.
   3. The scene: machine.js (three.js, bundled) loads after the first LCP entry, the first scroll, or load + 1.5 s,
      whichever comes first. It fades in over the poster on its first frame and removes the poster.
   4. No WebGL 2, a scene that fails to load, or a lost context: html.motion goes and the page shows the stills.
   Reads no URL, storage or cookie values and sends nothing. */
(function () {
  var d = document.documentElement;
  if (!d.classList.contains("motion")) return;
  function stills() { d.classList.remove("motion"); }
  if (!window.WebGL2RenderingContext) return stills();

  var stage = document.querySelector(".pin .stage"), hero = document.querySelector("[data-hero]");
  var poster = document.getElementById("poster"), machine = document.getElementById("machine");
  var phone = matchMedia("(max-width: 640px)").matches;
  // Where the scene centres the machine across the stage (its camera's horizontal view offset), and on phones the
  // machine's top at p = 0 with no offset, both as fractions (width, height). capture.py measures TOP from the poster.
  var AX = phone ? 0.5 : 0.67, TOP = 0.335, GAP = 20;

  function layout() {
    var h = machine.clientHeight;
    var dy = phone ? Math.round(Math.max(0.27 * h, hero.offsetTop + hero.offsetHeight + GAP - TOP * h)) : 0;
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
    // The poster image is 2x the viewport it was captured at; its height maps to the stage height (the camera's
    // vertical field of view is fixed), and its AX point to the stage's AX point.
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
    show();
    if (started) return;
    started = true;
    machine.addEventListener("webglcontextlost", stills, { once: true });
    import("./machine.js").catch(stills);
  }
  try {
    new PerformanceObserver(function () { setTimeout(go, 0); }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) { /* no LCP API: the scroll or load triggers start both */ }
  addEventListener("scroll", go, { passive: true, once: true });
  function loaded() { show(); setTimeout(go, 1500); }
  if (document.readyState === "complete") loaded();
  else addEventListener("load", loaded, { once: true });
})();
