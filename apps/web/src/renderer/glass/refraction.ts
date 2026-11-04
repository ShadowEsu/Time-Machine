// Vendored from Glisse 0.5.0 (https://github.com/0kzh/glisse, commit 46be5ba, MIT, LICENSE-glisse), src/internal/refraction.ts.
// Changes: the React hook useRefraction became attachGlass(element), and the tab bar's selection lens is left out.
import { createLens, fitBackdropLens, shapeOf, type Lens, type LensOptions, type Shape } from "./lens.js";

// Glass bends what's behind it with the same lens as the switch, slider and
// tab bar (see lens.ts), shaped as Aave's free-moving lens, the first demo in
// its article, and scaled to the glass: a rim band a quarter of its shorter
// side wide, a dome that sags the whole half of it, and a reach of 0.45 of
// it, Aave's 72px on its 160px lens. --lg-glass-bend overrides the strength,
// and --lg-glass-dispersion how far its colours split (0.4: red bends 8%
// further than blue). The light on its rim the glass paints over its own
// frost, as iOS does (below).
export const GLASS: LensOptions = {
  strength: 0.45,
  strengthProperty: "--lg-glass-bend",
  dispersion: 0.4,
  dispersionProperty: "--lg-glass-dispersion",
  depth: 0.25,
  dome: 0.5,
  splay: 1,
  relative: true,
  paintsLight: true,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The light on glass's rim, as iOS 26.1 draws it on `.glassEffect()`,
// measured at 3x over flat grey: a line brightest at the very edge and gone
// 1.2px in, slightly bowed. A light from the top left lights the whole of
// the left side and top, and its reflection the right side and bottom; it
// fades out over the corners between, and is a little wider on the two
// corners it faces. Over 50% grey it lifts the glass 0.65 of the way to
// white on a light page and 0.3 on a dark one (0.13 over black). Part of
// that is the backdrop's own colour, which iOS lets through at the edge, so
// a rim of white alone reads harsher: --lg-rim-shine sets it at 0.3 on a
// light page and 0.13 on a dark one, iOS's white alone over black.
//
// Under the light it draws the glass's 0.5px --lg-edge line, which CSS would
// otherwise draw over it as an inset shadow (see styles.css).
const RIM_WIDTH = 1.22;
const EDGE_WIDTH = 0.5;

/** An sRGB colour, 0–255, with alpha 0–1. */
type Colour = readonly [number, number, number, number];

/** The rim's light, white, over its edge line, at `density` pixels to the px. */
export function rimMap(
  { width, height, radius }: Shape,
  shine: number,
  density: number,
  edge: Colour = [0, 0, 0, 0],
): { columns: number; rows: number; data: Uint8ClampedArray } {
  const columns = Math.max(1, Math.round(width * density));
  const rows = Math.max(1, Math.round(height * density));
  const data = new Uint8ClampedArray(columns * rows * 4);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corner = clamp(radius, 0, Math.min(halfWidth, halfHeight));
  const half = 0.5 / density;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = ((column + 0.5) / columns) * width - halfWidth;
      const y = ((row + 0.5) / rows) * height - halfHeight;
      const depth = -distance(x, y, halfWidth, halfHeight, corner);
      if (depth < -half || depth > 2 * RIM_WIDTH) continue;
      // The nearest edge's outward normal.
      const qx = Math.abs(x) - halfWidth + corner;
      const qy = Math.abs(y) - halfHeight + corner;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const length = Math.hypot(qx, qy);
        nx = (Math.sign(x) * qx) / length;
        ny = (Math.sign(y) * qy) / length;
      } else if (qx > qy) nx = Math.sign(x);
      else ny = Math.sign(y);
      // 1 along the lit sides, √2 on the corners they meet at, 0 on the others.
      const facing = Math.abs(nx + ny);
      const along = Math.max(0, depth) / (RIM_WIDTH * Math.sqrt(Math.max(1, facing)));
      // How much of the pixel the shape, and the edge line, cover.
      const cover = clamp((depth + half) * density, 0, 1);
      const lined = clamp((Math.min(EDGE_WIDTH, depth + half) - Math.max(0, depth - half)) * density, 0, 1);
      const light = along < 1 ? shine * Math.min(1, facing) ** 1.5 * (1 - along ** 1.5) * cover : 0;
      const line = edge[3] * lined * (1 - light);
      const alpha = light + line;
      if (alpha <= 0) continue;
      const i = (row * columns + column) * 4;
      for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round((255 * light + edge[channel]! * line) / alpha);
      data[i + 3] = Math.round(255 * alpha);
    }
  }
  return { columns, rows, data };
}

// A CSS colour as sRGB and alpha, by the canvas's own parsing.
function parseColour(context: CanvasRenderingContext2D, colour: string): Colour {
  context.fillStyle = "#0000";
  context.fillStyle = colour;
  const value = String(context.fillStyle);
  if (value.startsWith("#")) {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
    return [r!, g!, b!, 1];
  }
  const [r = 0, g = 0, b = 0, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b, a];
}

const rims = new Map<string, string>();
let palette: CanvasRenderingContext2D | null | undefined;

// Sets the glass's --lg-rim for its size, corners and page, and marks it
// data-rim, as its rim now draws its edge line.
function paintRim(element: HTMLElement): void {
  const style = getComputedStyle(element);
  const shape = shapeOf(element, style);
  palette ??= document.createElement("canvas").getContext("2d");
  if (!shape || !palette) return;
  const tuned = parseFloat(style.getPropertyValue("--lg-rim-shine"));
  const shine = Number.isFinite(tuned) ? clamp(tuned, 0, 1) : 0.13;
  const edge = parseColour(palette, style.getPropertyValue("--lg-edge").trim() || "transparent");
  const density = Math.min(devicePixelRatio || 1, 3);
  const key = [shape.width, shape.height, shape.radius, shine, edge, density].join("|");
  let url = rims.get(key);
  if (!url) {
    const { columns, rows, data } = rimMap(shape, shine, density, edge);
    const canvas = document.createElement("canvas");
    canvas.width = columns;
    canvas.height = rows;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(columns, rows);
    image.data.set(data);
    context.putImageData(image, 0, 0);
    url = `url("${canvas.toDataURL()}")`;
    rims.set(key, url);
  }
  element.style.setProperty("--lg-rim", url);
  element.setAttribute("data-rim", "");
}

// What to repaint when the page's theme changes, which no resize reports: a
// data-theme set anywhere, or the system's light or dark.
const repaints = new Set<() => void>();
let unwatch: (() => void) | undefined;

function onThemeChange(repaint: () => void): () => void {
  repaints.add(repaint);
  if (!unwatch) {
    const run = () => repaints.forEach((each) => each());
    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"], subtree: true });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener?.("change", run);
    unwatch = () => {
      observer.disconnect();
      scheme.removeEventListener?.("change", run);
    };
  }
  return () => {
    repaints.delete(repaint);
    if (repaints.size) return;
    unwatch?.();
    unwatch = undefined;
  };
}

function whenIdle(callback: () => void): () => void {
  if ("requestIdleCallback" in window) {
    const handle = requestIdleCallback(callback, { timeout: 500 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(callback, 50);
  return () => clearTimeout(handle);
}

interface Fitting {
  /** Fits again now, once it has fitted at all: for settings changed without a resize. */
  refit(): void;
  /** Stops, and removes what fitting set. */
  stop(): void;
}

// Fits the glass once the page is idle, and again whenever it changes size.
function refitting(element: HTMLElement, fit: () => void, properties: string[]): Fitting {
  let cancel: (() => void) | undefined;
  let fitted = false;
  const observer = new ResizeObserver(() => {
    cancel?.();
    cancel = whenIdle(() => {
      fitted = true;
      fit();
    });
  });
  observer.observe(element);
  return {
    refit: () => {
      if (fitted) fit();
    },
    stop: () => {
      cancel?.();
      observer.disconnect();
      for (const name of properties) element.style.removeProperty(name);
    },
  };
}

/** Only Chromium applies SVG filters to the live backdrop. */
export const refractsBackdrop = (): boolean => /Chrom(?:e|ium)\//.test(navigator.userAgent);

const MARK = "data-glisse-backdrop";

// The part of an element that can be seen, cut down by every ancestor that
// clips its overflow (a large image inside a small scroller shows only the scroller).
function visibleBox(element: HTMLElement): DOMRect {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/hidden|clip|auto|scroll/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) continue;
    const clip = node.getBoundingClientRect();
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/** The marked content behind the glass: the closest one whose visible part it overlaps. */
function findBackdrop(element: HTMLElement): HTMLElement | null {
  const box = element.getBoundingClientRect();
  const behind = (candidate: HTMLElement) => {
    if (candidate.contains(element) || element.contains(candidate)) return false;
    const other = visibleBox(candidate);
    return other.left < box.right && other.right > box.left && other.top < box.bottom && other.bottom > box.top;
  };
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const found = [...node.querySelectorAll<HTMLElement>(`[${MARK}]`)].find(behind);
    if (found) return found;
  }
  return null;
}

// The lenses kept over marked content, by the content. Each frame, one lens
// over each piece of content places them all (see lens.ts), so the bend
// stays under every glass however it or the content moves.
const followed = new Map<HTMLElement, Set<Lens>>();
let following = 0;

function follow(): void {
  for (const lenses of followed.values()) lenses.values().next().value?.update();
  following = followed.size ? requestAnimationFrame(follow) : 0;
}

// Makes the glass a lens over the marked content behind it, as a thumb is
// over its track: the content is filtered with the glass's map placed where
// the glass stands, and the glass frosts it as usual.
function bend(element: HTMLElement, source: HTMLElement): Fitting {
  const lens = createLens(element, source, GLASS);
  let started = false;
  const fitting = refitting(
    element,
    () => {
      paintRim(element);
      if (started) return lens.refit();
      started = true;
      lens.setActive(true);
      let lenses = followed.get(source);
      if (!lenses) followed.set(source, (lenses = new Set()));
      lenses.add(lens);
      following ||= requestAnimationFrame(follow);
    },
    ["--lg-rim"],
  );
  return {
    refit: fitting.refit,
    stop: () => {
      fitting.stop();
      const lenses = followed.get(source);
      lenses?.delete(lens);
      if (lenses && !lenses.size) followed.delete(source);
      lens.destroy();
    },
  };
}

/**
 * Makes `element` glass: a lit rim and, where the browser can (Chromium), a lens that bends
 * what's behind it; content marked `data-glisse-backdrop` behind it is bent in every browser.
 * Returns a function that stops it and removes what it set.
 */
export function attachGlass(element: HTMLElement): () => void {
  const source = findBackdrop(element);
  const fitting = source
    ? bend(element, source)
    : refitting(
        element,
        () => {
          paintRim(element);
          if (refractsBackdrop()) fitBackdropLens(element, GLASS);
        },
        ["--lg-filter", "--lg-rim"],
      );
  const stopWatching = onThemeChange(() => paintRim(element));
  return () => {
    stopWatching();
    fitting.stop();
    element.removeAttribute("data-rim");
  };
}
