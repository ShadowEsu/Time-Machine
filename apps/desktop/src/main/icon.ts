// Draws the menu bar icon: the app's playhead glyph with a small verdict dot. No image files needed.
import { deflateSync } from "node:zlib";
import type { DotState } from "./rules.js";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// Working is grey, never a verdict color: nothing has been proven yet.
const COLORS: Record<DotState, [number, number, number]> = { pass: [34, 197, 94], fail: [239, 68, 68], none: [142, 142, 138], working: [142, 142, 138] };

/** The menu bar image and whether macOS should draw it as a template (tinted for a light or dark menu bar). */
export interface TrayImage {
  png: Buffer;
  template: boolean;
}

/** Colors for the playhead glyph and the verdict dot, and whether the image is a template. */
export interface TrayColors {
  template: boolean;
  glyph: [number, number, number];
  dot: [number, number, number];
}

// Mid grey reads on a light or a dark bar. Linux and Windows do not tint template images.
const GREY: [number, number, number] = [120, 120, 118];

/**
 * With no verdict to show, macOS gets a black template image, so it draws it like every other
 * menu bar item. Other systems draw the image as is, so they get grey. A pass or fail dot keeps
 * its color, so those images are never templates.
 */
export function trayColors(state: DotState, platform: NodeJS.Platform): TrayColors {
  const idle = state === "none" || state === "working";
  if (idle && platform === "darwin") return { template: true, glyph: [0, 0, 0], dot: [0, 0, 0] };
  return { template: false, glyph: GREY, dot: idle ? GREY : COLORS[state] };
}

/** A 32 px image meant to be shown at 16 pt (scale factor 2). */
export function trayIcon(state: DotState, platform: NodeJS.Platform = process.platform): TrayImage {
  const S = 32;
  const out = Buffer.alloc(S * S * 4);
  const { template, glyph, dot } = trayColors(state, platform);
  const SS = 4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let g = 0;
      let d = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // Playhead, the same shape as the app icon: a bar under a head with a flat top,
          // straight shoulders and slants that meet the bar.
          const ax = Math.abs(px - 12.25);
          const bar = ax <= 1.25 && py >= 9 && py <= 29;
          const head = py >= 3 && py <= 10 && ax <= Math.min(5, 5 - (py - 6.5) * (3.75 / 3.5));
          // Verdict dot. Not checked yet is a hollow ring, never a filled color.
          const r = Math.hypot(px - 23, py - 22);
          // Working is an open 270 degree arc, the still frame of the spec's rotating arc.
          const ring = r <= 6 && r >= 3.8;
          const inDot = state === "none" ? ring : state === "working" ? ring && !(px > 23 && py < 22) : r <= 6;
          if (inDot) d++;
          else if (bar || head) g++;
        }
      }
      const i = (y * S + x) * 4;
      const n = SS * SS;
      const c = d >= g ? dot : glyph;
      const a = Math.max(d, g) / n;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = Math.round(a * 255);
    }
  }
  return { png: png(S, out), template };
}
