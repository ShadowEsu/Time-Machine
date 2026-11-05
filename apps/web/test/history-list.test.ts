// History as a list: what is selected first, what the status line says, what each row and each mark of the mini-ruler
// shows, where the keys go, which quiet save points fold, and how the preview sheet opens, follows and closes.
import { describe, expect, test } from "vitest";
import { brokeAt, brokenNumbers, brokenTitle, carriedVerdict, changedSince, defaultPick, foldRepeats, foldRuns, keptKey, listMove, openAfterReload, rowVerdict, RULER_MARKS, rulerMarks, SHEET_SIDE_MIN, sheetKey, sheetLayout, showsBackToNow, statusLine, type ListPoint } from "../src/renderer/history-list.ts";

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
  test("an opened fold stays open as rows, even when selecting its newest leaves four of it in a row", () => {
    const opened = new Set(["q-1", "q-2", "q-3", "q-4", "q-5"]);
    expect(foldRuns(run(5), quiet, opened).every((x) => "row" in x)).toBe(true);
    expect(foldRuns(run(5).slice(1), quiet, opened).every((x) => "row" in x)).toBe(true);
    // A run that has none of them still folds.
    expect(shape(run(4, 6))).toEqual(["fold q-6 x4"]);
  });
});

describe("what changed since a save point", () => {
  const changes = new Map<string, string[]>([
    ["cp-0004", ["src/theme.js"]],
    ["cp-0005", ["src/theme.js", "src/app.js"]],
    ["cp-0006", []],
    ["cp-0007", ["test/theme.test.js"]],
  ]);
  test("is every path a later save point changed, newest first, once each", () => {
    expect(changedSince(demo, "cp-0003", changes)).toEqual({ paths: ["test/theme.test.js", "src/theme.js", "src/app.js"], known: true });
  });
  test("is nothing for the newest, and says when a later change is not read yet", () => {
    expect(changedSince(demo, "cp-0007", changes)).toEqual({ paths: [], known: true });
    expect(changedSince(demo, "cp-0002", changes).known).toBe(false);
    expect(changedSince(demo, "nope", changes)).toEqual({ paths: [], known: false });
  });
});

describe("the preview sheet", () => {
  const side = { mode: "side", typing: false } as const;
  const page = { mode: "page", typing: false } as const;

  test("at 1440 it sits beside the list and traps nothing; at 390 it is a page of its own with Back, and its one primary in a bar at its foot", () => {
    expect(sheetLayout(1440)).toEqual({ mode: "side", modal: false, back: false, bar: false });
    expect(sheetLayout(390)).toEqual({ mode: "page", modal: true, back: true, bar: true });
    expect(sheetLayout(SHEET_SIDE_MIN).mode).toBe("side");
    expect(sheetLayout(SHEET_SIDE_MIN - 1).mode).toBe("page");
  });

  test("Enter on a row opens it: beside the list focus stays on the row, so the arrows keep previewing; as a page focus goes into it", () => {
    expect(sheetKey("Enter", { ...side, at: "list", open: false })).toEqual({ open: true, move: 0, focus: "list" });
    expect(sheetKey("Enter", { ...page, at: "list", open: false })).toEqual({ open: true, move: 0, focus: "sheet" });
    // Enter on a control inside the sheet is that control's own.
    expect(sheetKey("Enter", { ...side, at: "sheet", open: true })).toBeNull();
  });

  test("Esc closes it from the row, from inside it or from its name field, and focus goes back to the row", () => {
    for (const at of ["list", "sheet", "other"] as const) {
      expect(sheetKey("Escape", { ...side, at, open: true })).toEqual({ open: false, move: 0, focus: "list" });
      expect(sheetKey("Escape", { ...page, at, open: true })).toEqual({ open: false, move: 0, focus: "list" });
    }
    expect(sheetKey("Escape", { ...side, at: "sheet", open: true, typing: true })).toEqual({ open: false, move: 0, focus: "list" });
    expect(sheetKey("Escape", { ...side, at: "list", open: false })).toBeNull();
  });

  test("↑ and ↓ inside the sheet beside the list move the selection and it stays open; on the list they stay the list's own", () => {
    expect(sheetKey("ArrowDown", { ...side, at: "sheet", open: true })).toEqual({ open: true, move: 1, focus: null });
    expect(sheetKey("ArrowUp", { ...side, at: "sheet", open: true })).toEqual({ open: true, move: -1, focus: null });
    expect(sheetKey("ArrowDown", { ...side, at: "list", open: true })).toBeNull();
    // As a page over History they scroll it, and in a field they move the caret.
    expect(sheetKey("ArrowDown", { ...page, at: "sheet", open: true })).toBeNull();
    expect(sheetKey("ArrowDown", { ...side, at: "sheet", open: true, typing: true })).toBeNull();
  });

  test("F2 renames from the row or the sheet: it opens with the name field in focus, never while typing", () => {
    expect(sheetKey("F2", { ...side, at: "list", open: false })).toEqual({ open: true, move: 0, focus: "name" });
    expect(sheetKey("F2", { ...page, at: "list", open: false })).toEqual({ open: true, move: 0, focus: "name" });
    expect(sheetKey("F2", { ...side, at: "sheet", open: true })).toEqual({ open: true, move: 0, focus: "name" });
    expect(sheetKey("F2", { ...side, at: "sheet", open: true, typing: true })).toBeNull();
  });

  test("an open sheet is no trip to the past: Back to now stays for Compare, so the sheet's Bring back is the one dark action", () => {
    expect(showsBackToNow("history")).toBe(false);
    expect(showsBackToNow("compare")).toBe(true);
    expect(showsBackToNow("overview")).toBe(false);
  });
});

describe("after a bring back (B4)", () => {
  // The engine saves the folder before every bring back, with the note "Before recovering <id>" and the trigger "recover".
  const save = (id: string, of: string | null, verdict: ListPoint["verdict"] = null) => ({ id, verdict, trigger: of ? "recover" : "manual", note: of ? `Before recovering ${of}` : "Added dark mode" });

  test("the broken version saved before going back has one name; repeats are numbered in the order they were made", () => {
    const pts = [save("cp-0001", null), save("cp-0002", null, "FAIL"), save("cp-0003", "cp-0001"), save("cp-0004", "cp-0001"), save("cp-0005", null), save("cp-0006", "cp-0001")];
    const n = brokenNumbers(pts);
    expect([...n]).toEqual([["cp-0003", 1], ["cp-0004", 2], ["cp-0006", 3]]);
    expect(brokenTitle(n.get("cp-0003") ?? 0)).toBe("Your broken version, saved before going back");
    expect(brokenTitle(n.get("cp-0004") ?? 0)).toBe("Your broken version #2, saved before going back");
    // A save someone made with those words by hand is not one: the trigger says who made it.
    expect(brokenNumbers([{ id: "cp-0001", trigger: "manual", note: "Before recovering cp-0009" }]).size).toBe(0);
  });

  test("repeats next to each other fold under the newest, which stays a row; an opened or selected one unfolds them", () => {
    const rows = ["b3", "b2", "b1", "x", "b0"].map((id) => ({ id }));
    const broken = (c: { id: string }): boolean => c.id.startsWith("b");
    const shape = (keep: (c: { id: string }) => boolean): string[] =>
      foldRepeats(rows.map((row) => ({ row })), broken, keep).map((x) => ("fold" in x ? `fold ${x.fold} x${x.rows.length}${x.repeat ? " repeat" : ""}` : x.row.id));
    expect(shape(() => false)).toEqual(["b3", "fold b2 x2 repeat", "x", "b0"]);
    expect(shape((c) => c.id === "b1")).toEqual(["b3", "b2", "b1", "x", "b0"]);
    // A quiet fold already made stays as it is.
    const quiet = foldRepeats([{ fold: "q1", rows: [{ id: "q1" }] }, { row: { id: "b1" } }], broken, () => false);
    expect(quiet).toEqual([{ fold: "q1", rows: [{ id: "q1" }] }, { row: { id: "b1" } }]);
  });

  test("a save never checked carries the verdict of the saves before it while no file changed between them", () => {
    const pts: ListPoint[] = [{ id: "cp-0002", verdict: "FAIL" }, { id: "cp-0003", verdict: null }, { id: "cp-0004", verdict: null }];
    expect(carriedVerdict(pts, "cp-0003", new Map([["cp-0003", []]]))).toBe("FAIL");
    expect(carriedVerdict(pts, "cp-0003", new Map([["cp-0003", ["src/app.js"]]]))).toBe(null);
    // Not read yet is not "nothing changed".
    expect(carriedVerdict(pts, "cp-0003", new Map())).toBe(null);
    expect(carriedVerdict([{ id: "a", verdict: "PASS" }, { id: "b", verdict: "FAIL" }], "b", new Map([["b", []]]))).toBe("FAIL");
    // A second bring back saves the same broken folder again: it carries through the first one.
    expect(carriedVerdict(pts, "cp-0004", new Map([["cp-0003", []], ["cp-0004", []]]))).toBe("FAIL");
    expect(carriedVerdict(pts, "cp-0004", new Map([["cp-0003", ["a.js"]], ["cp-0004", []]]))).toBe(null);
    expect(carriedVerdict(pts, "cp-0004", new Map([["cp-0004", []]]))).toBe(null);
  });

  test("after a reload the banner offers Undo for the newest recovery this tm ui made, until Keep it", () => {
    const a = { id: "cp-0001", branch: "tm/recover/cp-0001", copyDir: "/x/app-recovered-cp-0001", undoable: true };
    const b = { id: "cp-0003", branch: "tm/recover/cp-0003", copyDir: "/x/app-recovered-cp-0003", undoable: true };
    expect(openAfterReload([a, b], new Set(), "p1")).toEqual(b);
    expect(openAfterReload([a, b], new Set([keptKey("p1", b)]), "p1")).toBe(null);
    // Kept in another project is not kept here.
    expect(openAfterReload([a, b], new Set([keptKey("p2", b)]), "p1")).toEqual(b);
    // One made before tm ui started can't be undone from here: no banner offers it.
    expect(openAfterReload([a, { ...b, undoable: false }], new Set(), "p1")).toBe(null);
    expect(openAfterReload([{ ...a, copyDir: "" }], new Set(), "p1")).toBe(null);
    expect(openAfterReload([], new Set(), "p1")).toBe(null);
  });
});
