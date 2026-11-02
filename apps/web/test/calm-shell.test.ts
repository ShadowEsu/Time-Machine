// The Calm shell (B6a, Design's B6 spec §1): the one All ▾ filter menu and its counts, the header's More menu, Settings'
// own sections and its Back row, Recent in the sidebar, and the keys of a menu and of the phone's drawer. No window needed:
// the smoke (~/tm-scratch/b6a/smoke.mjs) checks the same things in the real tm ui.
import { describe, expect, test } from "vitest";
import type { RunNote } from "../src/shared/api.ts";
import { filterCounts, filtered } from "../src/renderer/runs.ts";
import { addRecent, filterChoices, filterMenu, menuStep, moreItems, RECENT_MAX, settingsBack, SETTINGS_SECTIONS, SIDEBAR_WIDTH, trapStep, type RecentItem } from "../src/renderer/shell.ts";

const pts = [
  { id: "cp-0001", verdict: null },
  { id: "cp-0002", verdict: "PASS" },
  { id: "cp-0003", verdict: "FAIL" },
  { id: "cp-0004", verdict: "PASS" },
  { id: "cp-0005", verdict: "FAIL" },
];
const note = (n: Partial<RunNote>): RunNote => ({ pinned: false, updated: "2026-11-02T10:00:00Z", ...n });
const notes = new Map<string, RunNote>([["cp-0002", note({ title: "Added dark mode" })], ["cp-0003", note({ pinned: true })]]);

describe("the All ▾ filter menu", () => {
  test("offers All, Works, Named and Pinned, each with how many save points it shows", () => {
    const counts = { all: pts.length, ...filterCounts(pts, notes, true) };
    const choices = filterChoices("all", counts);
    expect(choices.map((c) => `${c.label} ${c.count}`)).toEqual(["All 5", "Works 2", "Named 1", "Pinned 1"]);
    // Each count is what choosing it shows.
    for (const c of choices) expect(filtered(pts, notes, c.v)).toHaveLength(c.count);
    expect(choices.filter((c) => c.on).map((c) => c.v)).toEqual(["all"]);
  });

  test("a project with no check has no Works choice", () => {
    expect(filterChoices("all", { all: 5, ...filterCounts(pts, notes, false) }).map((c) => c.v)).toEqual(["all", "named", "pinned"]);
  });

  test("closed, it is one button that names the choice in force; open, a menu of radio items with the one in force checked", () => {
    const counts = { all: 5, works: 2, named: 1, pinned: 1 };
    const closed = filterMenu("works", counts, "code", false);
    expect(closed.match(/<button/g)).toHaveLength(1);
    expect(closed).toMatch(/aria-haspopup="menu" aria-expanded="false"/);
    expect(closed).toContain('aria-label="Show: Works, 2 save points"');
    expect(closed).not.toContain('role="menu"');
    const open = filterMenu("works", counts, "research", true);
    expect(open).toMatch(/aria-expanded="true"/);
    expect(open).toContain('role="menu" aria-label="Show runs"');
    const items = [...open.matchAll(/role="menuitemradio" aria-checked="(true|false)" data-act="journal-filter" data-v="(\w+)"/g)].map((m) => `${m[2]}:${m[1]}`);
    expect(items).toEqual(["all:false", "works:true", "named:false", "pinned:false"]);
    expect([...open.matchAll(/<span class="jf-n">(\d+)<\/span>/g)].map((m) => m[1])).toEqual(["2", "5", "2", "1", "1"]);
  });
});

describe("a menu's keys", () => {
  test("↓ and ↑ move one item and wrap round; Home and End go to the ends; other keys are not the menu's", () => {
    expect(menuStep("ArrowDown", 0, 4)).toBe(1);
    expect(menuStep("ArrowDown", 3, 4)).toBe(0);
    expect(menuStep("ArrowUp", 0, 4)).toBe(3);
    expect(menuStep("Home", 2, 4)).toBe(0);
    expect(menuStep("End", 1, 4)).toBe(3);
    expect(menuStep("Tab", 1, 4)).toBeNull();
    expect(menuStep("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("the header's More menu", () => {
  const sel = { id: "cp-0002", name: "“Added dark mode”", pinned: false };

  test("holds Ask, Pin, Rename and the project's settings, in that order, for the selected save point", () => {
    expect(moreItems({ project: "p1", askOpen: false, selected: sel }).map((i) => i.label)).toEqual(["Ask", "Pin “Added dark mode”", "Rename “Added dark mode”", "Project settings"]);
    const acts = moreItems({ project: "p1", askOpen: false, selected: sel }).map((i) => `${i.act}:${i.id ?? ""}`);
    expect(acts).toEqual(["ask-toggle:", "pin:cp-0002", "rename:cp-0002", "project-settings:p1"]);
  });

  test("says Unpin for a pinned save point and Hide Ask while Ask is open", () => {
    expect(moreItems({ project: "p1", askOpen: true, selected: { ...sel, pinned: true } }).map((i) => i.label)).toEqual(["Hide Ask", "Unpin “Added dark mode”", "Rename “Added dark mode”", "Project settings"]);
  });

  test("with no save point selected it has no Pin or Rename, and outside a project it holds none of these", () => {
    expect(moreItems({ project: "p1", askOpen: false, selected: null }).map((i) => i.act)).toEqual(["ask-toggle", "project-settings"]);
    expect(moreItems({ project: null, askOpen: false, selected: sel })).toEqual([]);
  });
});

describe("Settings' own sidebar", () => {
  test("lists Plan and license, Storage, Appearance, Agents and About", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual(["Plan and license", "Storage", "Appearance", "Agents", "About"]);
  });

  test("Back returns to the screen Settings was opened from, never to another part of Settings", () => {
    expect(settingsBack("history", true)).toBe("history");
    expect(settingsBack("sources", true)).toBe("sources");
    expect(settingsBack("storage", true)).toBe("overview");
    expect(settingsBack("settings", true)).toBe("overview");
    expect(settingsBack(null, true)).toBe("overview");
    // Nothing protected yet: the app's first page.
    expect(settingsBack(null, false)).toBe("welcome");
    expect(settingsBack("overview", false)).toBe("welcome");
  });
});

describe("the sidebar", () => {
  test("is 248 px wide", () => {
    expect(SIDEBAR_WIDTH).toBe(248);
  });

  test("Recent keeps the last five, newest first, each save point once", () => {
    let r: RecentItem[] = [];
    for (let i = 1; i <= 7; i++) r = addRecent(r, { projectId: "p1", id: `cp-000${i}`, label: `Save ${i}` });
    expect(r).toHaveLength(RECENT_MAX);
    expect(r.map((x) => x.id)).toEqual(["cp-0007", "cp-0006", "cp-0005", "cp-0004", "cp-0003"]);
    r = addRecent(r, { projectId: "p1", id: "cp-0005", label: "Brought back “Save 5”" });
    expect(r.map((x) => x.label)).toEqual(["Brought back “Save 5”", "Save 7", "Save 6", "Save 4", "Save 3"]);
    // The same id in another project is another save point.
    expect(addRecent(r, { projectId: "p2", id: "cp-0007", label: "Other" }).map((x) => x.projectId)).toEqual(["p2", "p1", "p1", "p1", "p1"]);
  });
});

// Esc and the veil closing the drawer, and focus coming back to Open sidebar, are checked in the real tm ui by the smoke.
describe("a modal's Tab (the phone's drawer, the confirm)", () => {
  test("Tab and Shift+Tab go round inside it", () => {
    expect(trapStep(5, 4, false)).toBe(0);
    expect(trapStep(5, 0, true)).toBe(4);
    expect(trapStep(5, 2, false)).toBe(3);
    // Focus outside it comes back in at the first (or, going back, the last) control.
    expect(trapStep(5, -1, false)).toBe(0);
    expect(trapStep(5, -1, true)).toBe(4);
  });
});
