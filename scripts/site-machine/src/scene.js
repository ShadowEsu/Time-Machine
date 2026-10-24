// Time Machine site, S5 "The Stack": a white machine built from thick modules, one per save point, each with a lit
// seam. Scroll opens it into an exploded view, checks each save point top to bottom (red seams for cp-0006, cp-0005,
// cp-0004, green for cp-0003), then cp-0003 slides out towards you while the others close back up.
// Units: decimetres (the machine is 28 cm wide). Every pose is a pure function of p, so scrolling back restores it.
// Built into site/assets/machine/machine.js by `node scripts/build-site-machine.mjs` (esbuild 0.28.2, see there).
import { THREE, createStage, screenTexture, ease, SAVES } from "./stage.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const { seg, mix, inOut, out } = ease;
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const SANS = 'Inter, system-ui, sans-serif';
const INK = "#141414", INK2 = "#3a3936";
const SEAM = { idle: new THREE.Color("#b4d6ff"), scan: new THREE.Color("#ffffff"), fail: new THREE.Color("#ff4a3d"), pass: new THREE.Color("#2fd27a") };

// Dimensions. Layers stack bottom (cp-0003, the oldest) to top (cp-0006, the newest), so the rewind runs downward.
const D = { W: 2.8, Dp: 2.2, foot: 0.05, baseH: 0.5, H: 0.3, seam: 0.024, capH: 0.32, gap: 0.5, r: 0.11 };
const ORDER = [3, 2, 1, 0]; // ORDER[i] = index into SAVES for layer i (bottom up): cp-0003, cp-0004, cp-0005, cp-0006
const baseTop = D.foot + D.baseH;
const pitch = D.H + D.seam;
const layerY = (i) => baseTop + D.seam + D.H / 2 + i * pitch;
const capY0 = baseTop + 4 * pitch + D.capH / 2 + 0.012; // on the top module, over a thin dark gap

const parts = { layers: [] };
let readout;

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function shapeMesh(w, h, r, mat) {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, h, r), 12), mat);
  const uv = m.geometry.attributes.uv, p = m.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return m;
}

function build(st) {
  const { scene, root } = st;
  // White: a satin polymer with a soft clearcoat (the Apple/Braun white); base and cap a touch greyer, so the modules
  // read as the bright, separate parts.
  const white = new THREE.MeshPhysicalMaterial({ color: "#f8f8f6", roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: new THREE.Color("#ffffff"), sheenRoughness: 0.55 });
  const shell = white.clone(); shell.color = new THREE.Color("#efeeeb"); shell.roughness = 0.42;
  const gapMat = new THREE.MeshStandardMaterial({ color: "#2a2928", roughness: 0.9 });
  const steel = new THREE.MeshPhysicalMaterial({ color: "#ffffff", metalness: 0.5, roughness: 0.3, envMapIntensity: 1.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: "#3b3a38", roughness: 0.85 });

  const machine = new THREE.Group();
  root.add(machine);
  parts.machine = machine;

  // ---- base: a plinth on a recessed rubber foot, with a smoked-glass readout and a small status light
  const base = new THREE.Mesh(new RoundedBoxGeometry(D.W + 0.12, D.baseH, D.Dp + 0.12, 8, D.r + 0.03), shell);
  base.position.y = D.foot + D.baseH / 2;
  base.castShadow = base.receiveShadow = true;
  machine.add(base);
  const foot = new THREE.Mesh(new RoundedBoxGeometry(D.W - 0.3, D.foot * 2, D.Dp - 0.3, 3, 0.04), rubber);
  foot.position.y = D.foot * 0.5;
  machine.add(foot);
  const front = (D.Dp + 0.12) / 2;
  readout = screenTexture(1400, 180, drawReadout);
  const glass = shapeMesh(1.9, 0.24, 0.06, new THREE.MeshPhysicalMaterial({ color: "#0d0f10", roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, emissive: "#ffffff", emissiveMap: readout.texture, emissiveIntensity: 1.1 }));
  glass.position.set(-0.22, D.foot + D.baseH / 2, front + 0.003);
  machine.add(glass);
  const bezel = new THREE.Mesh(new THREE.ExtrudeGeometry((() => { const s = roundedRect(1.98, 0.32, 0.1); s.holes.push(roundedRect(1.9, 0.24, 0.06)); return s; })(), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 }), shell);
  bezel.position.set(-0.22, D.foot + D.baseH / 2, front - 0.012);
  machine.add(bezel);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 10), new THREE.MeshStandardMaterial({ color: "#26394f", emissive: "#9fcbff", emissiveIntensity: 1.8, roughness: 0.3 }));
  led.position.set(1.12, D.foot + D.baseH / 2, front + 0.004);
  machine.add(led);
  parts.led = led;

  // ---- steel alignment dowels: on the base and on each layer's top face; hidden inside the module above when closed
  const dowelGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.2, 20);
  const dowelAt = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [sx * (D.W / 2 - 0.3), sz * (D.Dp / 2 - 0.3)]);
  function dowels(parent, y) {
    for (const [x, z] of dowelAt) { const d = new THREE.Mesh(dowelGeo, steel); d.position.set(x, y, z); d.castShadow = true; parent.add(d); }
  }
  dowels(machine, baseTop + 0.08);

  // ---- the four save point modules
  const moduleGeo = new RoundedBoxGeometry(D.W, D.H, D.Dp, 7, D.r);
  const seamGeo = new RoundedBoxGeometry(D.W - 0.1, D.seam + 0.002, D.Dp - 0.1, 3, 0.03);
  for (let i = 0; i < 4; i++) {
    const save = SAVES[ORDER[i]];
    const g = new THREE.Group();
    const body = new THREE.Mesh(moduleGeo, white);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    // The lit seam: a light-guide plate under the module, its edge a line of light when the stack is closed. Unlit and
    // not tone-mapped, so the sky, red and green stay saturated against the white.
    const seamMat = new THREE.MeshBasicMaterial({ color: SEAM.idle.clone(), toneMapped: false });
    const seam = new THREE.Mesh(seamGeo, seamMat);
    seam.position.y = -D.H / 2 - D.seam / 2;
    g.add(seam);
    dowels(g, D.H / 2 + 0.08);
    // Printed front: the save point id, its note and time, and the verdict once checked.
    const label = screenTexture(2048, 200, (ctx, w, h, state) => drawLabel(ctx, w, h, save, state));
    const print = new THREE.Mesh(new THREE.PlaneGeometry(D.W - 0.34, (D.W - 0.34) * (200 / 2048)), new THREE.MeshPhysicalMaterial({ map: label.texture, transparent: true, roughness: 0.36, clearcoat: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    print.position.set(0, 0, D.Dp / 2 + 0.002);
    g.add(print);
    g.position.y = layerY(i);
    machine.add(g);
    parts.layers.push({ g, seam: seamMat, label, save, state: "" });
  }

  // ---- the cap: a perforated grille ring around a sky keycap (the restore key)
  const cap = new THREE.Group();
  const capBody = new THREE.Mesh(new RoundedBoxGeometry(D.W, D.capH, D.Dp, 8, D.r + 0.02), shell);
  capBody.castShadow = capBody.receiveShadow = true;
  cap.add(capBody);
  // The lid's gap: a fine shadow line, not a lit seam (the cap is the lid, not a save point).
  const capGap = new THREE.Mesh(new RoundedBoxGeometry(D.W - 0.12, 0.01, D.Dp - 0.12, 2, 0.03), new THREE.MeshStandardMaterial({ color: "#c9c5be", roughness: 0.9 }));
  capGap.position.y = -D.capH / 2 - 0.006;
  cap.add(capGap);
  const holeGeo = new THREE.CircleGeometry(0.022, 14).rotateX(-Math.PI / 2);
  const ringN = [{ r: 0.5, n: 30 }, { r: 0.62, n: 38 }, { r: 0.74, n: 46 }];
  const holes = new THREE.InstancedMesh(holeGeo, new THREE.MeshStandardMaterial({ color: "#2b2a29", roughness: 0.95 }), ringN.reduce((a, b) => a + b.n, 0));
  const m4 = new THREE.Matrix4();
  let k = 0;
  for (const { r, n } of ringN) for (let j = 0; j < n; j++) { const a = (j / n) * Math.PI * 2; m4.makeTranslation(Math.cos(a) * r, D.capH / 2 + 0.002, Math.sin(a) * r); holes.setMatrixAt(k++, m4); }
  cap.add(holes);
  const well = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.02, 64), gapMat);
  well.position.y = D.capH / 2 - 0.004;
  cap.add(well);
  const key = new THREE.Group();
  const keyMat = new THREE.MeshPhysicalMaterial({ color: "#cfe6ff", roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const keyBody = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.35, 0.09, 64), keyMat);
  const keyTop = new THREE.Mesh(new THREE.SphereGeometry(1.6, 64, 8, 0, Math.PI * 2, 0, Math.asin(0.34 / 1.6)), keyMat);
  keyTop.position.y = 0.045 - 1.6 * Math.cos(Math.asin(0.34 / 1.6));
  keyBody.castShadow = keyTop.castShadow = true;
  key.add(keyBody, keyTop);
  key.position.y = D.capH / 2 + 0.04;
  cap.add(key);
  parts.key = key;
  cap.position.y = capY0;
  machine.add(cap);
  parts.cap = cap;

  // ---- floor that only shows shadow: the long late-afternoon shadow falls across the room's own gradient and fades
  // out radially (centred a little down-shadow of the machine), so it never meets the canvas edge as a cropped band.
  const shadowMat = new THREE.ShadowMaterial({ color: "#5e5249", opacity: 0.15 });
  shadowMat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vFloor;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFloor = (modelMatrix * vec4(transformed, 1.0)).xz;");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vFloor;")
      .replace("gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );",
        "gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) * ( 1.0 - smoothstep( 1.6, 3.4, length( vFloor - vec2( 0.5, -0.3 ) ) ) ) );");
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), shadowMat);
  floor.receiveShadow = true;
  scene.add(floor);

  // ---- light: a low warm sun from the left-front (long soft shadow to the right-back), a cool sky rim, env fill
  const sun = new THREE.DirectionalLight("#fff0e2", 2.6);
  sun.position.set(-9, 5.2, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 22;
  sun.shadow.blurSamples = 24;
  sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -6, right: 11, top: 9, bottom: -5, near: 1, far: 30 });
  scene.add(sun);
  const rim = new THREE.DirectionalLight("#dceaff", 1.1);
  rim.position.set(6, 5, -6);
  scene.add(rim);
}

function drawLabel(ctx, w, h, save, state) {
  const y = h / 2;
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  ctx.font = `500 92px ${MONO}`;
  ctx.fillText(save.id, 24, y);
  const idW = ctx.measureText(save.id).width;
  ctx.fillStyle = INK2;
  ctx.font = `500 78px ${SANS}`;
  ctx.fillText(save.note, 24 + idW + 52, y);
  // Right: the verdict pill once checked, else the save time
  ctx.textAlign = "right";
  if (state === "fail" || state === "pass" || state === "scan") {
    const t = state === "fail" ? "FAIL" : state === "pass" ? "PASS" : "Checking";
    const [bg, fg] = state === "fail" ? ["#fbe1db", "#b3261e"] : state === "pass" ? ["#dff3e4", "#17733e"] : ["#cfe6ff", INK];
    ctx.font = `700 64px ${SANS}`;
    const tw = ctx.measureText(t).width, pw = tw + 72, ph = 132, px = w - 24 - pw, py = y - ph / 2;
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(px, py, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(t, w - 24 - 36, y + 2);
  } else {
    ctx.fillStyle = INK2;
    ctx.font = `400 72px ${MONO}`;
    ctx.fillText(save.time, w - 24, y);
  }
  ctx.textAlign = "left";
}

function drawReadout(ctx, w, h, text = "4 save points · ready", tone = "#cfe6ff") {
  ctx.fillStyle = "#0d0f10";
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = "middle";
  ctx.fillStyle = tone;
  ctx.beginPath(); ctx.arc(70, h / 2, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#eef3f8";
  ctx.font = `500 70px ${MONO}`;
  const fit = Math.min(70, Math.floor((70 * (w - 160)) / ctx.measureText(text).width));
  ctx.font = `500 ${fit}px ${MONO}`;
  ctx.fillText(text, 120, h / 2 + 2);
}

const subs = [...document.querySelectorAll("[data-sub]")];
const hero = document.querySelector("[data-hero]");
const cue = document.querySelector("[data-cue]");
const live = document.querySelector("[data-live]");
// The poster is the p=0 frame. The canvas is transparent, so the poster must go as soon as a frame renders anywhere
// else (the scene loads on the first scroll, so its first frame is often past 0), or once the fade-in ends.
let poster = document.getElementById("poster");
const dropPoster = () => { poster?.remove(); poster = null; };
let shownSub = -1, shownRead = "", announced = "";
const target = new THREE.Vector3(), camPos = new THREE.Vector3(), col = new THREE.Color();

// Beats (p): hold .00-.06 · open .06-.26 · checks .28-.53 (top down, .07 apart) · cp-0003 out .60-.80 · close .68-.86
const CHECK = (j) => [0.28 + 0.07 * j, 0.28 + 0.07 * j + 0.04];

function update(p, st) {
  const { camera, phone } = st;
  const L = parts.layers;
  if (poster && p > 0.0005) dropPoster();

  // Open: the cap lifts first, then each module, top to bottom; every gap is D.gap when fully open.
  // A small overshoot as each module arrives (backOut over inOut: still from rest, a few percent past, back).
  const back = (x, s = 1.1) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
  const open = (k) => back(inOut(seg(p, 0.06 + 0.025 * k, 0.2 + 0.025 * k))); // k = 0 cap, 1 top module ... 4 bottom
  const out3 = inOut(seg(p, 0.6, 0.8)); // cp-0003 slides out
  const close = inOut(seg(p, 0.68, 0.86)); // the rest close back up into its place
  for (let i = 0; i < 4; i++) {
    const g = L[i].g, e = open(4 - i) * (1 - (i === 0 ? 0 : close));
    let y = layerY(i) + (i + 1) * D.gap * e, x = 0, z = 0, yaw = 0, roll = 0;
    if (i === 0) {
      // cp-0003: forward out of the stack, a small lift on the way, then down to rest in front of it, turned to you. It
      // rests on its own seam plate, so the green light pools on the floor (the floor shows only shadow, so nothing may
      // sit below it).
      y = mix(layerY(0) + D.gap * open(4), D.seam + D.H / 2 + 0.002, out(seg(p, 0.66, 0.86))) + 0.22 * Math.sin(Math.PI * out3);
      x = (phone ? -0.5 : -2.25) * out3;
      z = (phone ? 2.75 : 2.35) * out3;
      yaw = 0.4 * out3;
      roll = 0.03 * Math.sin(Math.PI * out3);
    } else {
      y -= pitch * close; // drop into the vacated slot
    }
    // A breath of rotation while a module travels: it reads as a separate, weighted part
    const travel = Math.sin(Math.PI * seg(p, 0.06 + 0.025 * (4 - i), 0.2 + 0.025 * (4 - i)));
    g.position.set(x, y, z);
    g.rotation.set(roll, yaw + 0.035 * travel * (i % 2 ? 1 : -1), 0.01 * travel);
  }
  parts.cap.position.y = capY0 + 5 * D.gap * open(0) * (1 - close) - pitch * close;

  // Checks, top (cp-0006) to bottom (cp-0003): seam idle sky -> scanning white -> red or green; label pill follows
  let read = "4 save points · ready", tone = "#cfe6ff", say = "";
  for (let j = 0; j < 4; j++) {
    const li = 3 - j, layer = L[li], [a, b] = CHECK(j);
    const scan = seg(p, a, b), done = p >= b;
    const state = done ? (layer.save.pass ? "pass" : "fail") : scan > 0 ? "scan" : "";
    const pulse = Math.sin(Math.PI * scan);
    if (done) col.copy(layer.save.pass ? SEAM.pass : SEAM.fail); else col.copy(SEAM.idle).lerp(SEAM.scan, pulse);
    layer.seam.color.copy(col);
    if (state !== layer.state) { layer.label.redraw(state); layer.state = state; }
    if (scan > 0) { read = done ? `${layer.save.id} · ${layer.save.pass ? "passed" : "failed"}` : `checking ${layer.save.id}`; tone = done ? (layer.save.pass ? "#2fd27a" : "#ff4a3d") : "#ffffff"; }
    if (done) say = `${layer.save.id} · ${layer.save.note} · ${layer.save.pass ? "tests passed" : "tests failed"}`;
  }
  if (p >= 0.6) { read = "brought back · tm/recover/cp-0003"; tone = "#2fd27a"; say = "cp-0003 brought back on branch tm/recover/cp-0003, in a separate copy"; }
  if (read !== shownRead) { readout.redraw(read, tone); shownRead = read; }
  parts.led.material.emissive.set(tone);
  if (say !== announced) { live.textContent = say; announced = say; }
  // The restore key presses as cp-0003 leaves
  const press = seg(p, 0.585, 0.605) - seg(p, 0.62, 0.64);
  parts.key.position.y = D.capH / 2 + 0.04 - 0.035 * press;

  // Camera: 3/4 product shot -> pulled back for the open stack -> lower and frontal for the module out front
  const cam = [
    { p: 0, az: 34, el: 17, d: 11.2, ty: 1.15 },
    { p: 0.24, az: 26, el: 13, d: 16.4, ty: 2.5 },
    { p: 0.56, az: 20, el: 11, d: 16.0, ty: 2.3 },
    { p: 0.86, az: 14, el: 15, d: 14.0, ty: 1.1 },
  ];
  let k = 0;
  while (k < cam.length - 2 && p > cam[k + 1].p) k++;
  const A = cam[k], B = cam[k + 1], q = inOut(seg(p, A.p, B.p));
  // Phones: further back under the hero (it's taller there), then closer once it's gone, back out for cp-0003 in front.
  const pf = phone ? mix(2.15, 1.85, seg(p, 0.03, 0.2)) + 0.35 * seg(p, 0.6, 0.86) : 1;
  // Phones look down a little more at the end, so cp-0003 in front sits below the base's readout, not over it.
  const elDeg = mix(A.el, B.el, q) + (phone ? 9 * seg(p, 0.6, 0.86) : 0);
  const az = (mix(A.az, B.az, q) * Math.PI) / 180, el = (elDeg * Math.PI) / 180, d = mix(A.d, B.d, q) * pf;
  target.set((phone ? -0.35 : -0.7) * out3, mix(A.ty, B.ty, q) + (phone ? -0.35 : 0), mix(0, 0.9, seg(p, 0.6, 0.86)));
  camPos.set(target.x + Math.sin(az) * Math.cos(el) * d, target.y + Math.sin(el) * d, target.z + Math.cos(az) * Math.cos(el) * d);
  camera.position.copy(camPos);
  camera.lookAt(target);
  // Desktop: the machine sits in the right 60 %. Phones: under the hero first (load.js puts its top below the hero's
  // last line and draws the poster with the same offset, data-dy), centred once the hero text has gone.
  const w = st.canvas.clientWidth, h = st.canvas.clientHeight, dy = st.canvas.dataset.dy;
  if (phone) camera.setViewOffset(w, h, 0, -mix(dy === undefined ? h * 0.27 : +dy, h * 0.08, seg(p, 0.03, 0.2)), w, h);
  else camera.setViewOffset(w, h, -w * 0.17, 0, w, h);

  // HTML: hero text out, subtitles in
  const heroOut = seg(p, 0.03, 0.12);
  hero.style.opacity = String(1 - heroOut);
  hero.style.transform = `translateY(${-14 * heroOut}px)`;
  hero.style.visibility = heroOut >= 1 ? "hidden" : "";
  cue.style.opacity = p < 0.02 ? "" : "0";
  const n = p < 0.27 ? -1 : p < 0.53 ? 0 : p < 0.6 ? 1 : 2;
  if (n !== shownSub) { subs.forEach((s, i) => s.classList.toggle("on", i === n)); shownSub = n; }
  return false;
}

const canvas = document.getElementById("machine");
const stage = createStage({ canvas, pin: document.querySelector(".pin"), fov: 24, exposure: 1.0, envIntensity: 0.7, contact: { size: 10, y: 0.001, blur: 3.4, darkness: 1.3, opacity: 0.55 }, build, update });
// load.js moves the machine under the hero on phones (data-dy) and says so when the hero's height changes.
canvas.addEventListener("layout", () => stage.request());
// The canvas fades in over the poster on its first frame drawn with the page's faces (the poster was captured with
// them, so the two match at p=0); labels drawn in a fallback face would not. The poster then goes on transitionend.
canvas.addEventListener("transitionend", dropPoster, { once: true });
Promise.all([`500 92px ${MONO}`, `400 72px ${MONO}`, `500 78px ${SANS}`, `700 64px ${SANS}`].map((f) => document.fonts.load(f))).finally(() => {
  for (const l of parts.layers) l.label.redraw(l.state);
  shownRead = "";
  stage.request();
  requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.add("on")));
});
// Test hook for the poster/still capture tool, which sets window.__machineCapture before the page loads; pages
// themselves get no global.
if (window.__machineCapture === true) {
  stage.ready = true;
  window.__stage = stage;
}
