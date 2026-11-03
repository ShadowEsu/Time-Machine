// Scrubbing the Rewind's ruler: a drag picks the save point under the pointer, the keys land where the
// verdict changed, and the entry glide flicks each tick as the playhead crosses it.
import { describe, expect, test } from "vitest";
import { crossings, glideTime, nearestTick, sceneX, stepIndex } from "../src/renderer/scrub.ts";

describe("a drag picks the tick under the pointer", () => {
  test("on the Rewind ruler, the pointer picks the slot it is in", () => {
    const n = 4;
    const xs = Array.from({ length: n }, (_, i) => sceneX(i, n));
    // Slots are 25% wide: 0-25 is the first save point, 75-100 the newest.
    expect(nearestTick(xs, 24)).toBe(0);
    expect(nearestTick(xs, 26)).toBe(1);
    expect(nearestTick(xs, 99)).toBe(3);
  });

  test("exactly between two ticks, the older one wins, so the pick never flickers toward Now", () => {
    expect(nearestTick([10, 20], 15)).toBe(0);
  });
});

describe("keys step through save points", () => {
  // Oldest first: works, works, works, not checked, not checked, broken.
  const keys = ["pass", "pass", "pass", "none", "none", "fail"];

  test("back and forward move one save point and stop at the ends", () => {
    expect(stepIndex(keys, 3, "back")).toBe(2);
    expect(stepIndex(keys, 3, "forward")).toBe(4);
    expect(stepIndex(keys, 0, "back")).toBe(0);
    expect(stepIndex(keys, 5, "forward")).toBe(5);
    expect(stepIndex(keys, 3, "first")).toBe(0);
    expect(stepIndex(keys, 3, "last")).toBe(5);
  });

  test("a change step back from Broken skips save points never checked: where it went red is one key", () => {
    expect(stepIndex(keys, 5, "prevChange")).toBe(2);
    // From a save point never checked, back to the newest checked one.
    expect(stepIndex(keys, 4, "prevChange")).toBe(2);
  });

  test("a change step forward from Works lands on the first checked save point after the change", () => {
    expect(stepIndex(keys, 1, "nextChange")).toBe(5);
    expect(stepIndex(keys, 3, "nextChange")).toBe(5);
  });

  test("with every save point checked, a change step lands on the run next to this one", () => {
    const runs = ["fail", "fail", "pass", "pass", "fail"];
    expect(stepIndex(runs, 4, "prevChange")).toBe(3);
    expect(stepIndex(runs, 3, "prevChange")).toBe(1);
    expect(stepIndex(runs, 0, "nextChange")).toBe(2);
    expect(stepIndex(runs, 2, "nextChange")).toBe(4);
  });

  test("with no change left, a change step goes to the end and no further", () => {
    expect(stepIndex(["pass", "pass", "pass"], 2, "prevChange")).toBe(0);
    expect(stepIndex(["pass", "pass", "pass"], 0, "nextChange")).toBe(2);
    expect(stepIndex(["pass", "none", "none"], 0, "nextChange")).toBe(2);
    expect(stepIndex([], 0, "back")).toBe(0);
  });
});

describe("the Rewind's entry glide", () => {
  test("the glide starts slow, is halfway at half time, and ends on time", () => {
    expect(glideTime(0, 420)).toBe(0);
    expect(glideTime(0.5, 420)).toBe(210);
    expect(glideTime(1, 420)).toBe(420);
    // Ease in: covering the first tenth takes much more than a tenth of the time.
    expect(glideTime(0.1, 420)).toBeGreaterThan(42);
  });

  test("the playhead crosses the ticks between Now and the target, nearest to Now first", () => {
    const n = 6;
    const xs = Array.from({ length: n }, (_, i) => sceneX(i, n));
    const at = crossings(xs, 2, 420);
    expect([...at.keys()]).toEqual([3, 4, 5]);
    expect(at.get(5)).toBeLessThan(at.get(4) ?? 0);
    expect(at.get(4)).toBeLessThan(at.get(3) ?? 0);
    for (const t of at.values()) expect(t).toBeLessThan(420);
  });

  test("landing on Now crosses nothing", () => {
    const xs = [10, 50, 90];
    expect(crossings(xs, 2, 420).size).toBe(0);
  });
});
