// Ruler and dial labels: a less important label moves or hides; labels never touch, never leave the frame.
import { describe, expect, test } from "vitest";
import { boxAround, dialCandidates, overlaps, placeLabels, rowCandidates, type Box } from "../src/renderer/label-fit.ts";

const row = (left: number, width: number): Box => ({ left, right: left + width, top: 52, bottom: 64 });
const wide: Box = { left: 0, right: 700, top: -Infinity, bottom: Infinity };

describe("ruler labels", () => {
  test("the last working time one step before Now keeps its place and Now gives way to its short form", () => {
    // 1440 window: ticks 61 px apart, a 79 px time and a 108 px "Now 10:46:43 AM", as QA measured.
    const lw = row(619 - 39.5, 79);
    const now = row(680 - 92, 108);
    const nowShort = row(680 - 19, 22);
    const placed = placeLabels([rowCandidates(lw), [...rowCandidates(now), ...rowCandidates(nowShort)]], wide, [], 8);
    expect(placed[0]).toBe(0);
    expect(placed[1]).toBeGreaterThanOrEqual(5);
    const chosen = [rowCandidates(lw)[placed[0] ?? 0], [...rowCandidates(now), ...rowCandidates(nowShort)][placed[1] ?? 0]];
    expect(overlaps(chosen[0] as Box, chosen[1] as Box, 8)).toBe(false);
  });

  test("a label with no room hides instead of sitting on a more important one", () => {
    expect(placeLabels([rowCandidates(row(100, 80)), rowCandidates(row(110, 80))], { ...wide, right: 200 }, [], 8)).toEqual([0, null]);
  });
});

describe("dial labels", () => {
  test("a label at the side of the dial stays inside its card and off its own dot", () => {
    const center = { x: 150, y: 150 };
    const dot = { x: 268, y: 150 };
    const dotBox = boxAround(dot.x, dot.y, 20, 20);
    const card: Box = { left: 8, top: 8, right: 292, bottom: 400 };
    const cands = dialCandidates(dot, center, 94, 16, 13, card);
    const [k] = placeLabels([cands], card, [dotBox], 6);
    expect(k).not.toBeNull();
    const b = cands[k ?? 0] as Box;
    expect(b.right).toBeLessThanOrEqual(card.right);
    expect(overlaps(b, dotBox)).toBe(false);
  });
});
