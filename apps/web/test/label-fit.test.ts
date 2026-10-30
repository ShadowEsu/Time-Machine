// Dial labels stay inside their card and off their dot.
import { describe, expect, test } from "vitest";
import { boxAround, dialCandidates, overlaps, placeLabels, type Box } from "../src/renderer/label-fit.ts";

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
