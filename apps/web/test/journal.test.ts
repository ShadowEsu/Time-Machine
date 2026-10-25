// The journal's "was Works at 8:06 PM": an entry names the verdict before it only when the recorded
// verdict changed, reaching past save points with no check, and never repeating the "Broke here" line.
import { describe, expect, test } from "vitest";
import type { Verdict } from "../src/shared/api.ts";
import { verdictWas } from "../src/renderer/journal.ts";

const story = (...verdicts: (Verdict | null)[]) => verdicts.map((verdict, i) => ({ id: `p${i}`, verdict }));
const was = (...verdicts: (Verdict | null)[]) => Object.fromEntries([...verdictWas(story(...verdicts))].map(([id, c]) => [id, c.id]));

describe("an entry says what the check was before it", () => {
  test("only where the recorded verdict changed", () => {
    expect(was("PASS", "PASS", "PASS")).toEqual({});
    expect(was("FAIL", "PASS")).toEqual({ p1: "p0" });
    expect(was("PASS", "INCOMPLETE", "INCOMPLETE")).toEqual({ p1: "p0" });
  });

  test("it reaches past save points with no check, which never start or end a change", () => {
    // Works, then two saves nobody checked, then Broken: the Broken one was Works, at p0.
    expect(was("PASS", null, null, "FAIL")).toEqual({ p3: "p0" });
    expect(was(null, "PASS", null)).toEqual({});
    expect(was("FAIL", null, "FAIL")).toEqual({});
  });

  test("a pass followed straight away by a fail is left to the Broke here line", () => {
    expect(was("PASS", "FAIL")).toEqual({});
    // The same pair with an unchecked save between them has no Broke here line, so the entry says it.
    expect(was("PASS", null, "FAIL")).toEqual({ p2: "p0" });
    // Back to Works after a fail is not a Broke here pair.
    expect(was("PASS", "FAIL", "PASS")).toEqual({ p2: "p1" });
  });

  test("each change points at the newest checked save point before it", () => {
    expect(was("PASS", "FAIL", "FAIL", "PASS", "ERROR")).toEqual({ p3: "p2", p4: "p3" });
  });
});
