// The app icon, drawn from code: the website's orange playhead over a save point timeline, on a
// dark tile. Every size is rendered on its own pixel grid, so edges stay crisp, and the build
// needs no image tools, fonts or network. Same input, same bytes.
//
//   node scripts/app-icon.mjs <dir>   writes icon-<size>.png for each size and icon.icns, to look at.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// Colors from the website: playhead orange, ink on dark, and the warm near-black stage.
const ORANGE = [255, 121, 31]; // #ff791f
const CREAM = [243, 240, 232]; // #f3f0e8
const TILE_TOP = [30, 28, 25]; // #1e1c19
const TILE_BOTTOM = [12, 11, 10]; // #0c0b0a

// Geometry in units of the 1024 px macOS icon grid: an 824 unit rounded tile, 100 units of margin.
const C = 512;
const HALF = 412;
// The playhead head is a pentagon: flat top, straight shoulders, then slants that meet the bar.
// Below 64 px the timeline would be mush, so small sizes show a bigger playhead alone.
const LARGE = { headTop: 228, headHalf: 108, shoulder: 300, tip: 408, barBottom: 752, bar: 56 };
const SMALL = { headTop: 220, headHalf: 176, shoulder: 330, tip: 520, barBottom: 812, bar: 104 };
const RULER = { y: 676, thick: 12, left: 214, right: 810, dots: [262, 387, 637, 762], dot: 21 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Signed distance in units to the tile edge, negative inside. A superellipse (n = 5), close to the macOS shape. */
function tileDistance(x, y) {
  const u = Math.abs(x - C) / HALF;
  const v = Math.abs(y - C) / HALF;
  const u4 = u * u * u * u;
  const v4 = v * v * v * v;
  const f = u4 * u + v4 * v;
  if (f === 0) return -HALF;
  const r = f ** 0.2;
  const r4 = r * r * r * r;
  return ((r - 1) * HALF * r4) / Math.hypot(u4, v4);
}

/** How much of the pixel column or row [p, p + 1) lies inside [a, b). */
function span(p, a, b) {
  return clamp01(Math.min(p + 1, b) - Math.max(p, a));
}

/** Snaps a centred length to whole pixels with the same parity as the canvas, so both edges are sharp. */
function snapped(center, length) {
  const w = Math.max(2, 2 * Math.round(length / 2));
  const a = Math.round(center - w / 2);
  return [a, a + w];
}

/** Composes a straight color with coverage `alpha` over the premultiplied pixel in `acc`. */
function over(acc, r, g, b, alpha) {
  if (alpha <= 0) return;
  const k = 1 - alpha;
  acc[0] = r * alpha + acc[0] * k;
  acc[1] = g * alpha + acc[1] * k;
  acc[2] = b * alpha + acc[2] * k;
  acc[3] = alpha + acc[3] * k;
}

/** Straight RGBA pixels of the icon at `size` px square. */
export function iconPixels(size) {
  const s = size / 1024;
  const detail = size >= 64;
  const g = detail ? LARGE : SMALL;
  // The playhead, in pixels. Straight edges sit on pixel boundaries; the bar keeps an even
  // width centred on the canvas, at least 2 px.
  const [barL, barR] = snapped(C * s, Math.max(g.bar * s, 2));
  const barT = Math.round(g.shoulder * s);
  const barB = Math.round(g.barBottom * s);
  const headT = Math.round(g.headTop * s);
  const [headL, headR] = snapped(C * s, 2 * g.headHalf * s);
  const headH = (headR - headL) / 2;
  const shoulder = g.shoulder * s;
  const tip = g.tip * s;
  // Outward unit normal of the right slant; the left one mirrors it.
  const len = Math.hypot(tip - shoulder, headH);
  const nx = (tip - shoulder) / len;
  const ny = headH / len;
  const thick = Math.max(1, Math.round(RULER.thick * s));
  const rulerT = Math.round(RULER.y * s - thick / 2);
  const rulerB = rulerT + thick;
  const dotReach = RULER.dot + 2 / s;
  // A light band along the top edge, a few pixels wide at any size.
  const rim = Math.max(1, 12 * s);
  const acc = new Float64Array(4);
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    const y = (py + 0.5) / s;
    const t = clamp01((y - (C - HALF)) / (2 * HALF));
    const tr = TILE_TOP[0] + (TILE_BOTTOM[0] - TILE_TOP[0]) * t;
    const tg = TILE_TOP[1] + (TILE_BOTTOM[1] - TILE_TOP[1]) * t;
    const tb = TILE_TOP[2] + (TILE_BOTTOM[2] - TILE_TOP[2]) * t;
    const rowLine = detail ? span(py, rulerT, rulerB) : 0;
    const nearRuler = detail && Math.abs(y - RULER.y) < dotReach;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / s;
      acc.fill(0);
      const d = tileDistance(x, y);
      // A soft shadow under the tile, inside the grid's margin.
      if (detail && d > -60) over(acc, 0, 0, 0, 0.34 * clamp01(1 - (tileDistance(x, y - 14) + 6) / 46) ** 2);
      const tile = clamp01(0.5 - d * s);
      if (tile > 0) {
        over(acc, tr, tg, tb, tile);
        // A faint light along the top edge, so the tile holds its shape on a dark Dock.
        if (detail) over(acc, CREAM[0], CREAM[1], CREAM[2], 0.12 * (1 - t) * tile * clamp01(1 + (d * s) / rim));
      }
      if (rowLine > 0) over(acc, CREAM[0], CREAM[1], CREAM[2], 0.26 * rowLine * span(px, RULER.left * s, RULER.right * s));
      if (nearRuler) {
        // Four save points on the timeline, dimmer than the playhead.
        let dot = 0;
        for (const dx of RULER.dots) dot = Math.max(dot, clamp01(0.5 - (Math.hypot(x - dx, y - RULER.y) - RULER.dot) * s));
        over(acc, CREAM[0], CREAM[1], CREAM[2], 0.72 * dot);
      }
      // The playhead, as in the app's timeline and menu bar icon, in the website's orange.
      const bar = span(px, barL, barR) * span(py, barT, barB);
      const ax = Math.abs(px + 0.5 - C * s);
      const slant = ax * nx + (py + 0.5 - tip) * ny;
      const head = span(px, headL, headR) * span(py, headT, size) * clamp01(0.5 - slant);
      over(acc, ORANGE[0], ORANGE[1], ORANGE[2], Math.max(bar, head));
      const a = acc[3];
      if (a > 0) {
        const i = (py * size + px) * 4;
        out[i] = Math.round(acc[0] / a);
        out[i + 1] = Math.round(acc[1] / a);
        out[i + 2] = Math.round(acc[2] / a);
        out[i + 3] = Math.round(a * 255);
      }
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** The icon at `size` px square as a PNG file. */
export function iconPng(size) {
  const rgba = iconPixels(size);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = size * 4 + 1;
  const raw = Buffer.alloc(size * row);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * row + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Every slot of a full macOS iconset (16 to 512 pt at 1x and 2x), each a PNG.
const ICNS_SLOTS = [["icp4", 16], ["icp5", 32], ["ic11", 32], ["ic12", 64], ["ic07", 128], ["ic13", 256], ["ic08", 256], ["ic14", 512], ["ic09", 512], ["ic10", 1024]];

/** The icon as a macOS .icns file, for the app bundle (Dock, Finder, About). */
export function iconIcns() {
  const pngs = new Map();
  const parts = ICNS_SLOTS.map(([type, size]) => {
    if (!pngs.has(size)) pngs.set(size, iconPng(size));
    const data = pngs.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: node scripts/app-icon.mjs <dir>");
  mkdirSync(dir, { recursive: true });
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) writeFileSync(join(dir, `icon-${size}.png`), iconPng(size));
  writeFileSync(join(dir, "icon.icns"), iconIcns());
  console.log(`Icon written to ${dir}.`);
}
