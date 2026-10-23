// Ruler and dial labels: a less important label hides, the last working one never drops, and dial labels
// stay inside their card and off their dot.
import { describe, expect, test } from "vitest";
import { boxAround, dialCandidates, fitRow, overlaps, placeLabels, type Box, type RowLabel } from "../src/renderer/label-fit.ts";

const row = (left: number, width: number): Box => ({ left, right: left + width, top: 52, bottom: 64 });
const label = (box: Box, more: Partial<RowLabel> = {}): RowLabel => ({ box, tickX: (box.left + box.right) / 2, lastWorking: false, now: false, short: null, ...more });

describe("ruler labels", () => {
  // A 1440 window: ticks 61 px apart, a 79 px time and a 108 px "Now 10:46:43 AM" anchored at -85 %, as QA measured.
  const nowTick = 680;
  const now = label(row(nowTick - 92, 108), { now: true, tickX: nowTick, short: row(nowTick - 19, 22) });

  test("the last working time one step before Now stays: it moves left of its tick and Now shows only Now", () => {
    const lwTick = nowTick - 61;
    const lw = label(row(lwTick - 39.5, 79), { lastWorking: true, tickX: lwTick });
    const fit = fitRow([now, lw]);
    expect(fit.hidden).toEqual([false, false]);
    expect(fit.nowShort).toBe(true);
    const lwBox = { ...lw.box, left: lw.box.left + (fit.dx[1] ?? 0), right: lw.box.right + (fit.dx[1] ?? 0) };
    expect(lwBox.right).toBe(lwTick - 6);
    expect(overlaps(lwBox, now.short as Box, 6)).toBe(false);
  });

  test("a selected time next to Now hides instead of touching it", () => {
    const sel = label(row(nowTick - 61 - 39.5, 79));
    expect(fitRow([now, sel]).hidden).toEqual([false, true]);
  });
});

describe("dial labels", () => {
  test("a label at the side of the dial goes above its dot, ends at it, and stays inside the card", () => {
    const center = { x: 150, y: 150 };
    const dot = { x: 268, y: 150 };
    const dotBox = boxAround(dot.x, dot.y, 20, 20);
    const card: Box = { left: 8, top: 8, right: 292, bottom: 400 };
    const cands = dialCandidates(dot, center, 94, 16, 13, card);
    const [k] = placeLabels([cands], card, [dotBox], 6);
    expect(k).toBe(0);
    const b = cands[0] as Box;
    expect(b.right).toBe(dot.x);
    expect(b.bottom).toBeLessThanOrEqual(dotBox.top);
    expect(overlaps(b, dotBox)).toBe(false);
  });
});
