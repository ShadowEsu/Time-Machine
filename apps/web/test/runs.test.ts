import { describe, expect, test } from "vitest";
import type { RunNote } from "../src/shared/api.ts";
import { changedLine, filterBar, filterCounts, filtered, nameCount, noneShown, noteBlock, noteSaveWords, rowTitle, shownTitle, unitWords } from "../src/renderer/runs.ts";
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

  test("Works, Named and Pinned each show only their save points, in order", () => {
    const pts = [{ id: "cp-0001", verdict: "PASS" }, { id: "cp-0002", verdict: "FAIL" }, { id: "cp-0003", verdict: null }, { id: "cp-0004", verdict: "PASS" }];
    const notes = new Map([["cp-0003", note({ pinned: true })], ["cp-0002", note({ title: "x" })], ["cp-0001", note({ pinned: true, title: "  " })]]);
    expect(filtered(pts, notes, "works").map((c) => c.id)).toEqual(["cp-0001", "cp-0004"]);
    expect(filtered(pts, notes, "named").map((c) => c.id)).toEqual(["cp-0002"]);
    expect(filtered(pts, notes, "pinned").map((c) => c.id)).toEqual(["cp-0001", "cp-0003"]);
    expect(filtered(pts, notes, "all")).toHaveLength(4);
    expect(filterCounts(pts, notes, true)).toEqual({ works: 2, named: 1, pinned: 2 });
    // A project with no check has no Works filter.
    expect(filterCounts(pts, notes, false).works).toBeNull();
  });

  test("the filter bar is All, Works, Named and Pinned, each with its count, in the project's word, and says what is pressed", () => {
    const bar = filterBar("works", { works: 1, named: 0, pinned: 2 }, "research");
    expect(bar).toContain('aria-label="Show runs"');
    expect(bar.match(/data-v="(\w+)"/g)).toEqual(['data-v="all"', 'data-v="works"', 'data-v="named"', 'data-v="pinned"']);
    expect(bar).toMatch(/class="on" aria-pressed="true" data-act="journal-filter" data-v="works">Works<span class="jf-n">1<\/span>/);
    expect(bar).toContain('data-v="named">Named<span class="jf-n">0</span>');
    expect(bar).toMatch(/data-v="pinned">.*Pinned<span class="jf-n">2<\/span>/);
    expect(filterBar("all", { works: null, named: 0, pinned: 0 }, "documents")).not.toContain('data-v="works"');
  });

  test("a filter that shows nothing says what it waits for and offers all of them", () => {
    expect(noneShown("pinned", "research")).toContain("No pinned runs yet.");
    expect(noneShown("works", "code")).toContain("No save points have passed their check yet.");
    expect(noneShown("named", "code")).toContain("No named save points yet.");
    for (const f of ["works", "named", "pinned"] as const) expect(noneShown(f, "code")).toContain('data-act="journal-filter" data-v="all">Show all');
  });

  test("the detail uses the project's word and says what is pressed", () => {
    const html = noteBlock("cp-0003", note({ title: "Baseline", pinned: true }), { id: "cp-0003", title: "Baseline", note: "" }, "research", false);
    expect(html).toContain("Name this run");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('maxlength="80"');
    expect(html).toContain('maxlength="2000"');
    expect(html).toContain("Saved on this computer");
  });

  test("the name shows how much of 80 is used, and the button and toast say what is saved", () => {
    const html = noteBlock("cp-0003", undefined, { id: "cp-0003", title: "Draft before advisor notes", note: "" }, "documents", false);
    expect(html).toContain('<span class="rn-count" id="rn-count">26/80</span>');
    expect(html).toContain('aria-describedby="rn-count"');
    expect(html).toContain(">Save name</button>");
    expect(noteSaveWords({ id: "x", title: "Draft", note: "" }, undefined)).toEqual({ button: "Save name", toast: "Name saved on this computer." });
    expect(noteSaveWords({ id: "x", title: "", note: "tried seed 7" }, undefined)).toEqual({ button: "Save note", toast: "Note saved on this computer." });
    expect(noteSaveWords({ id: "x", title: "Draft", note: "tried seed 7" }, undefined)).toEqual({ button: "Save name and note", toast: "Name and note saved on this computer." });
    expect(noteSaveWords({ id: "x", title: "Draft", note: "new" }, note({ title: "Draft", note: "old" })).button).toBe("Save note");
    expect(nameCount("   ")).toBe("0/80");
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
