// Draws the menu bar icon: the playhead glyph with a small verdict dot. No image files needed.
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

/** A 32 px image meant to be shown at 16 pt (scale factor 2). */
export function trayIcon(state: DotState): Buffer {
  const S = 32;
  const out = Buffer.alloc(S * S * 4);
  const glyph: [number, number, number] = [120, 120, 118];
  const dot = COLORS[state];
  const SS = 4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let g = 0;
      let d = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // Playhead: a bar with a downward triangle head.
          const bar = px >= 11 && px <= 13.5 && py >= 9 && py <= 29;
          const tri = py >= 3 && py <= 10 && Math.abs(px - 12.25) <= (10 - py) * 0.75;
          // Verdict dot. Not checked yet is a hollow ring, never a filled color.
          const r = Math.hypot(px - 23, py - 22);
          // Working is an open 270 degree arc, the still frame of the spec's rotating arc.
          const ring = r <= 6 && r >= 3.8;
          const inDot = state === "none" ? ring : state === "working" ? ring && !(px > 23 && py < 22) : r <= 6;
          if (inDot) d++;
          else if (bar || tri) g++;
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
  return png(S, out);
}
