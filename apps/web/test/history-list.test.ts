// History as a list and a preview: what is selected first, what the status line says, where the keys go and what
// changed since a save point.
import { describe, expect, test } from "vitest";
import { brokeAt, changedSince, defaultPick, foldRepeats, listMove, statusLine, type ListPoint } from "../src/renderer/history-list.ts";

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
    expect(statusLine({ newest: "FAIL", broke: "“Swapped the theme loader”", works: "“Added dark mode”", head: "Broken.", voice: "" })).toBe("Broken since “Swapped the theme loader”. “Added dark mode” still works.");
    expect(statusLine({ newest: "FAIL", broke: null, works: "2:58:48 AM #3", head: "Broken.", voice: "" })).toBe("Broken. 2:58:48 AM #3 still works.");
  });
  test("skips unchecked saves between the working one and the break", () => {
    const pts: ListPoint[] = [{ id: "a", verdict: "PASS" }, { id: "b", verdict: null }, { id: "c", verdict: "FAIL" }];
    expect(brokeAt(pts, "a")?.id).toBe("c");
    expect(brokeAt(pts, null)).toBeNull();
  });
  test("falls back to the status rule's head and time when nothing works behind a break", () => {
    expect(statusLine({ newest: "FAIL", broke: null, works: null, head: "Broken.", voice: "Since 2:58 AM." })).toBe("Broken. Since 2:58 AM.");
    expect(statusLine({ newest: "PASS", broke: null, works: "x", head: "Works.", voice: "" })).toBe("Works.");
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

describe("safety saves made one after another", () => {
  const rows = [{ id: "s3", k: "a" }, { id: "s2", k: "a" }, { id: "s1", k: "a" }, { id: "x", k: null }, { id: "y", k: null }, { id: "s0", k: "a" }];
  const key = (r: { k: string | null }): string | null => r.k;
  test("fold into the newest, which says how many more; rows without a key and rows apart never fold", () => {
    expect(foldRepeats(rows, key, null).map((r) => [r.c.id, r.more])).toEqual([["s3", 2], ["x", 0], ["y", 0], ["s0", 0]]);
  });
  test("stay whole when the selected row is one of them", () => {
    expect(foldRepeats(rows, key, "s2").map((r) => r.c.id)).toEqual(["s3", "s2", "s1", "x", "y", "s0"]);
  });
});
