// Time Machine site, S5 "The Stack": the stage under the machine. Renderer, generated studio light (three's
// RoomEnvironment through PMREM, 0 bytes of HDR), a soft contact shadow, and a scroll pin that hands the scene a
// progress p in [0, 1]. Render on demand only: a frame is drawn when p moves, the canvas resizes, or the scene asks,
// so an idle page costs nothing. Ported from Design's S5 prototype base (~/wN-tmp/s5/base/stage.js) with only what
// The Stack uses: no AO post pass, no environment panels, no knurl geometry.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js";

export { THREE };

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {HTMLElement} o.pin  tall section; the sticky stage inside it defines p
 * @param {number} [o.fov]
 * @param {number} [o.exposure]
 * @param {number} [o.envIntensity]
 * @param {{size:number, y:number, blur:number, darkness:number, opacity:number, res:number}} [o.contact]
 * @param {(stage) => void} o.build  builds the scene once
 * @param {(p:number, stage) => boolean|void} o.update  poses the scene for p; return true to keep animating
 */
export function createStage(o) {
  const canvas = o.canvas;
  const phone = matchMedia("(max-width: 640px)").matches;
  // preserveDrawingBuffer only for the poster/still capture tool, which sets this global before the page loads.
  const capture = window.__machineCapture === true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: capture });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = o.exposure ?? 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = o.envIntensity ?? 1;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(o.fov ?? 28, 1, 0.05, 100);
  const stage = { THREE, renderer, scene, camera, phone, canvas, p: 0, t: 0, root: new THREE.Group() };
  scene.add(stage.root);

  // ---- soft contact shadow (three's webgl_shadow_contact technique): the object's depth seen from below, blurred.
  const cs = Object.assign({ size: 3, y: 0, blur: 3.2, darkness: 1.4, opacity: 0.55, res: 512 }, o.contact || {});
  const shadowGroup = new THREE.Group();
  shadowGroup.position.y = cs.y;
  scene.add(shadowGroup);
  const rtA = new THREE.WebGLRenderTarget(cs.res, cs.res);
  const rtB = new THREE.WebGLRenderTarget(cs.res, cs.res);
  rtA.texture.generateMipmaps = rtB.texture.generateMipmaps = false;
  const planeGeo = new THREE.PlaneGeometry(cs.size, cs.size).rotateX(Math.PI / 2);
  const shadowPlane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: rtA.texture, opacity: cs.opacity, transparent: true, depthWrite: false }));
  shadowPlane.renderOrder = 1;
  shadowPlane.scale.y = -1;
  shadowGroup.add(shadowPlane);
  const blurPlane = new THREE.Mesh(planeGeo);
  blurPlane.visible = false;
  shadowGroup.add(blurPlane);
  const shadowCam = new THREE.OrthographicCamera(-cs.size / 2, cs.size / 2, cs.size / 2, -cs.size / 2, 0, 1.2);
  shadowCam.rotation.x = Math.PI / 2;
  shadowGroup.add(shadowCam);
  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.userData.darkness = { value: cs.darkness };
  depthMat.onBeforeCompile = (sh) => {
    sh.uniforms.darkness = depthMat.userData.darkness;
    sh.fragmentShader = "uniform float darkness;\n" + sh.fragmentShader.replace("gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );", "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );");
  };
  depthMat.depthTest = depthMat.depthWrite = false;
  const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
  hBlur.depthTest = vBlur.depthTest = false;
  function blur(amount) {
    blurPlane.visible = true;
    blurPlane.material = hBlur;
    hBlur.uniforms.tDiffuse.value = rtA.texture;
    hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(rtB);
    renderer.render(blurPlane, shadowCam);
    blurPlane.material = vBlur;
    vBlur.uniforms.tDiffuse.value = rtB.texture;
    vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(rtA);
    renderer.render(blurPlane, shadowCam);
    blurPlane.visible = false;
  }
  function renderContact() {
    shadowPlane.visible = false;
    scene.overrideMaterial = depthMat;
    const clear = renderer.getClearAlpha();
    renderer.setClearAlpha(0);
    renderer.setRenderTarget(rtA);
    renderer.clear();
    renderer.render(scene, shadowCam);
    scene.overrideMaterial = null;
    blur(cs.blur);
    blur(cs.blur * 0.4);
    renderer.setRenderTarget(null);
    renderer.setClearAlpha(clear);
    shadowPlane.visible = true;
  }

  // ---- size
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---- scroll progress: the sticky stage's own progress through the pin
  const pin = o.pin, sticky = pin ? [...pin.querySelectorAll("*")].find((e) => getComputedStyle(e).position === "sticky") : null;
  function readP() {
    if (!pin || !sticky) return 0;
    const top = parseFloat(getComputedStyle(sticky).top) || 0;
    const span = pin.offsetHeight - sticky.offsetHeight;
    return span > 0 ? Math.max(0, Math.min(1, (top - pin.getBoundingClientRect().top) / span)) : 0;
  }

  let raf = 0, last = performance.now(), keep = false;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    stage.t += dt;
    stage.dt = dt;
    keep = o.update(stage.p, stage) === true;
    renderContact();
    renderer.render(scene, camera);
    if (keep) request();
  }
  function request() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  stage.request = request;

  o.build(stage);
  resize();
  new ResizeObserver(() => { resize(); request(); }).observe(canvas);
  addEventListener("scroll", () => { stage.p = readP(); request(); }, { passive: true });
  stage.p = readP();

  // Test hook (stills, poster capture, verify): pose at p and resolve once that frame is on screen.
  stage.setP = (p, frames = 90) => new Promise((res) => {
    stage.p = p;
    let n = 0;
    const tick = () => { stage.p = p; frame(performance.now()); if (keep && n++ < frames) requestAnimationFrame(tick); else requestAnimationFrame(() => res()); };
    requestAnimationFrame(tick);
  });
  request();
  return stage;
}

/** A canvas texture for printed labels and the readout. redraw(...args) repaints it through draw(ctx, w, h, ...args). */
export function screenTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const redraw = (...a) => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h, ...a); texture.needsUpdate = true; };
  redraw();
  return { texture, redraw };
}

export const ease = {
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  out: (x) => 1 - Math.pow(1 - x, 3),
  seg: (p, a, b) => Math.max(0, Math.min(1, (p - a) / (b - a))),
  mix: (a, b, t) => a + (b - a) * t,
};

/** The real save points from the tm demo run. */
export const SAVES = [
  { id: "cp-0006", note: "Added a dependency", pass: false, time: "10:42:07" },
  { id: "cp-0005", note: "Changed currency", pass: false, time: "10:31:52" },
  { id: "cp-0004", note: "Agent: fixed lint warnings", pass: false, time: "10:18:40" },
  { id: "cp-0003", note: "Added dark mode", pass: true, time: "10:02:13" },
];
