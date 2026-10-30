// History as a list: what is selected first, what the status line says, what each row and each mark of the mini-ruler
// shows, where the keys go, and which quiet save points fold.
import { describe, expect, test } from "vitest";
import { brokeAt, defaultPick, foldRuns, listMove, rowVerdict, RULER_MARKS, rulerMarks, statusLine, type ListPoint } from "../src/renderer/history-list.ts";

// The demo's shape, oldest first: two unchecked saves, one that works, then four broken ones.
const demo: ListPoint[] = [
  { id: "cp-0001", verdict: null },
  { id: "cp-0002", verdict: null },
  { id: "cp-0003", verdict: "PASS" },
  { id: "cp-0004", verdict: "FAIL" },
  { id: "cp-0005", verdict: "FAIL" },
  { id: "cp-0006", verdict: "FAIL" },
  { id: "cp-0007", verdict: "FAIL" },
];

describe("the first selection", () => {
  test("is the last version that works while the newest is broken", () => {
    expect(defaultPick(demo, "cp-0003")).toBe("cp-0003");
  });
  test("is the newest when it works, when nothing works, or when the last working one is not in the list", () => {
    expect(defaultPick([...demo, { id: "cp-0008", verdict: "PASS" }], "cp-0008")).toBe("cp-0008");
    expect(defaultPick(demo, null)).toBe("cp-0007");
    expect(defaultPick(demo, "cp-0099")).toBe("cp-0007");
  });
  test("is nothing in an empty history", () => {
    expect(defaultPick([], null)).toBeNull();
  });
});

describe("the status line", () => {
  test("names where it broke and what still works, by message", () => {
    expect(brokeAt(demo, "cp-0003")?.id).toBe("cp-0004");
    expect(statusLine({ newest: "FAIL", broke: "“Swapped the theme loader”", works: "“Added dark mode”", head: "Broken.", voice: "Since 2:58:49 AM." })).toBe("Broken since “Swapped the theme loader”. “Added dark mode” still works.");
  });
  test("a save point with no message is said by its time, and starts its sentence with a capital", () => {
    expect(statusLine({ newest: "FAIL", broke: "the save at 2:58:49 AM", works: "the save at 2:58:48 AM", head: "Broken.", voice: "" })).toBe("Broken since the save at 2:58:49 AM. The save at 2:58:48 AM still works.");
    expect(statusLine({ newest: "FAIL", broke: null, works: "“Added dark mode”", head: "Broken.", voice: "" })).toBe("Broken. “Added dark mode” still works.");
  });
  test("skips unchecked saves between the working one and the break", () => {
    const pts: ListPoint[] = [{ id: "a", verdict: "PASS" }, { id: "b", verdict: null }, { id: "c", verdict: "FAIL" }];
    expect(brokeAt(pts, "a")?.id).toBe("c");
    expect(brokeAt(pts, null)).toBeNull();
  });
  test("falls back to the status rule's head and time when nothing works behind a break", () => {
    expect(statusLine({ newest: "FAIL", broke: null, works: null, head: "Broken.", voice: "Since 2:58:48 AM." })).toBe("Broken. Since 2:58:48 AM.");
    expect(statusLine({ newest: "PASS", broke: null, works: "“x”", head: "Works.", voice: "" })).toBe("Works.");
  });
});

describe("every row says its verdict in a word and an icon, never by colour alone", () => {
  test("Works, Broken and Not checked yet each have their word, their icon and their colour", () => {
    expect(rowVerdict("PASS", { checks: true })).toEqual({ key: "pass", word: "Works", icon: "verdict" });
    expect(rowVerdict("FAIL", { checks: true })).toEqual({ key: "fail", word: "Broken", icon: "verdict" });
    expect(rowVerdict(null, { checks: true })).toEqual({ key: "none", word: "Not checked yet", icon: "verdict" });
  });
  test("a check running, a damaged save point and a project with no check say so", () => {
    expect(rowVerdict(null, { checks: true, checking: true })).toMatchObject({ word: "Checking", icon: "glyph" });
    expect(rowVerdict("ERROR", { checks: true, damaged: true })).toMatchObject({ key: "damaged", word: "Damaged", icon: "glyph" });
    expect(rowVerdict(null, { checks: false })).toEqual({ key: "none", word: "Saved", icon: "none" });
  });
  test("every verdict has a word", () => {
    for (const v of ["PASS", "FAIL", "INCOMPLETE", "BLOCKED", "ERROR", null] as const) expect(rowVerdict(v, { checks: true }).word.length).toBeGreaterThan(0);
  });
});

describe("the mini-ruler", () => {
  test("has one mark per save point, newest first, in Overview's shapes: a glyph on Works and Broken, a hollow ring for Not checked yet", () => {
    const marks = rulerMarks(demo, "cp-0003", "cp-0003");
    expect(marks.map((m) => m.id)).toEqual(["cp-0007", "cp-0006", "cp-0005", "cp-0004", "cp-0003", "cp-0002", "cp-0001"]);
    expect(marks.map((m) => [m.key, m.glyph])).toEqual([["fail", true], ["fail", true], ["fail", true], ["fail", true], ["pass", true], ["none", false], ["none", false]]);
  });
  test("marks the selected save point and the last version that works", () => {
    const marks = rulerMarks(demo, "cp-0005", "cp-0003");
    expect(marks.filter((m) => m.on).map((m) => m.id)).toEqual(["cp-0005"]);
    expect(marks.filter((m) => m.lw).map((m) => m.id)).toEqual(["cp-0003"]);
  });
  test("shows the newest save points when there are more than it holds", () => {
    const many = Array.from({ length: RULER_MARKS + 5 }, (_, i): ListPoint => ({ id: `cp-${i}`, verdict: null }));
    const marks = rulerMarks(many, null, null);
    expect(marks).toHaveLength(RULER_MARKS);
    expect(marks[0]?.id).toBe(`cp-${RULER_MARKS + 4}`);
    expect(marks.at(-1)?.id).toBe("cp-5");
  });
});

describe("keys in the list", () => {
  test("Down goes older, Up newer, and both stop at the ends", () => {
    expect(listMove(7, 0, "ArrowDown")).toBe(1);
    expect(listMove(7, 6, "ArrowDown")).toBe(6);
    expect(listMove(7, 0, "ArrowUp")).toBe(0);
    expect(listMove(7, 3, "ArrowUp")).toBe(2);
  });
  test("Home is the newest, End the oldest, and Page keys step ten", () => {
    expect(listMove(7, 3, "Home")).toBe(0);
    expect(listMove(7, 3, "End")).toBe(6);
    expect(listMove(30, 3, "PageDown")).toBe(13);
    expect(listMove(30, 3, "PageUp")).toBe(0);
  });
  test("other keys and an empty list do nothing", () => {
    expect(listMove(7, 3, "Enter")).toBeNull();
    expect(listMove(0, 0, "ArrowDown")).toBeNull();
  });
});

describe("folding a run of quiet save points", () => {
  type Row = ListPoint & { named?: boolean; pinned?: boolean };
  const quiet = (c: Row): boolean => c.verdict === null && !c.named && !c.pinned;
  const run = (n: number, from = 1): Row[] => Array.from({ length: n }, (_, i) => ({ id: `q-${from + i}`, verdict: null }));
  const shape = (rows: Row[]): string[] => foldRuns(rows, quiet, new Set()).map((x) => ("fold" in x ? `fold ${x.fold} x${x.rows.length}` : x.row.id));

  test("three in a row stay as rows; four fold into one, keyed by the newest", () => {
    expect(shape(run(3))).toEqual(["q-1", "q-2", "q-3"]);
    expect(shape(run(4))).toEqual(["fold q-1 x4"]);
  });
  test("a named row breaks a run", () => {
    expect(shape([...run(2), { id: "n", verdict: null, named: true }, ...run(2, 3)])).toEqual(["q-1", "q-2", "n", "q-3", "q-4"]);
    expect(shape([...run(4), { id: "n", verdict: null, named: true }, ...run(3, 5)])).toEqual(["fold q-1 x4", "n", "q-5", "q-6", "q-7"]);
  });
  test("a pinned row breaks a run", () => {
    expect(shape([...run(3), { id: "p", verdict: null, pinned: true }, ...run(3, 4)])).toEqual(["q-1", "q-2", "q-3", "p", "q-4", "q-5", "q-6"]);
  });
  test("a row with a verdict breaks a run and is never folded: Works, Broken (where it broke) or any other", () => {
    for (const verdict of ["PASS", "FAIL", "ERROR"] as const) {
      expect(shape([...run(2), { id: "v", verdict }, ...run(2, 3)])).toEqual(["q-1", "q-2", "v", "q-3", "q-4"]);
    }
    expect(shape([{ id: "lw", verdict: "PASS" }, ...run(5), { id: "br", verdict: "FAIL" }])).toEqual(["lw", "fold q-1 x5", "br"]);
  });
  test("an opened fold stays open as rows", () => {
    expect(foldRuns(run(5), quiet, new Set(["q-1"])).every((x) => "row" in x)).toBe(true);
  });
});
