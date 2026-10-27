import { describe, expect, test } from "vitest";
import type { RunNote } from "../src/shared/api.ts";
import { changedLine, filterBar, filtered, noPinned, noteBlock, rowTitle, shownTitle, unitWords } from "../src/renderer/runs.ts";
import { filterPalette, savePointItem } from "../src/renderer/palette.ts";

const note = (over: Partial<RunNote> = {}): RunNote => ({ pinned: false, updated: "2026-10-25T05:00:00Z", ...over });

describe("runs: name, note and pin", () => {
  test("research says runs; everything else says save points", () => {
    expect(unitWords("research")).toEqual({ one: "run", many: "runs", One: "Run" });
    expect(unitWords("code").many).toBe("save points");
  });

  test("a row shows the person's own name when there is one", () => {
    expect(shownTitle("After agent turn", note({ title: "Baseline run, seed 42" }))).toBe("Baseline run, seed 42");
    expect(shownTitle("After agent turn", note({ title: "  " }))).toBe("After agent turn");
    expect(shownTitle("After agent turn", undefined)).toBe("After agent turn");
  });

  test("Pinned shows only pinned save points, in order", () => {
    const pts = [{ id: "cp-0001" }, { id: "cp-0002" }, { id: "cp-0003" }];
    const notes = new Map([["cp-0003", note({ pinned: true })], ["cp-0002", note({ title: "x" })], ["cp-0001", note({ pinned: true })]]);
    expect(filtered(pts, notes, "pinned").map((c) => c.id)).toEqual(["cp-0001", "cp-0003"]);
    expect(filtered(pts, notes, "all")).toHaveLength(3);
  });

  test("the filter and the detail use the project's word and say what is pressed", () => {
    const bar = filterBar("pinned", 2, "research");
    expect(bar).toContain('aria-label="Show runs"');
    expect(bar).toMatch(/class="on" aria-pressed="true" data-act="journal-filter" data-v="pinned"/);
    expect(noPinned("research")).toContain("No pinned runs yet.");
    const html = noteBlock("cp-0003", note({ title: "Baseline", pinned: true }), { id: "cp-0003", title: "Baseline", note: "" }, "research", false);
    expect(html).toContain("Name this run");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('maxlength="80"');
    expect(html).toContain('maxlength="2000"');
    expect(html).toContain("Saved on this computer");
  });

  test("Jump to lists a renamed save point by its new name, finds it by that name, and says it is pinned", () => {
    const item = savePointItem({ id: "cp-0003", verdict: "PASS" }, "2:16 AM", "After agent turn", note({ title: "Baseline run, seed 42", pinned: true }), "Works");
    expect(item.title).toBe("Baseline run, seed 42");
    expect(item.hint).toBe("Pinned · Works");
    expect(filterPalette([item], "seed 42")).toHaveLength(1);
    expect(savePointItem({ id: "cp-0001", verdict: null }, "1:00 AM", "First save point", undefined, "Not checked yet").title).toBe("First save point");
  });

  test("a row title is never empty: an untitled save names what changed, else how it was made", () => {
    expect(rowTitle("Fixed the intro", "app", ["notes/chapter-1.md"])).toBe("Fixed the intro");
    expect(rowTitle("", "app", ["notes/chapter-1.md"])).toBe("chapter-1.md");
    expect(rowTitle("  ", "app", ["notes/chapter-1.md", "a.md", "b.md"])).toBe("chapter-1.md and 2 more");
    expect(rowTitle("", "auto", undefined)).toBe("Auto save");
    expect(rowTitle("", "app", [])).toBe("Saved by you");
    expect(rowTitle("", "claude-code:stop", undefined)).toBe("Saved by Claude Code");
    for (const trigger of ["app", "auto", "cli", "recover", "claude-code:prompt", ""]) expect(rowTitle("", trigger, undefined).trim()).not.toBe("");
  });

  test("a journal row says what changed by name: one file, or the first and how many more", () => {
    expect(changedLine(["src/price.js"])).toBe("price.js");
    expect(changedLine(["notes/chapter-1.md", "a.md", "b.md"])).toBe("chapter-1.md and 2 more");
    expect(changedLine([])).toBe("");
    expect(changedLine(undefined)).toBe("");
  });
});
