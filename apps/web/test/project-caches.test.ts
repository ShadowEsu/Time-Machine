// Save point ids restart at cp-0001 in every project, so what the app keeps by id must go when the open project changes,
// or another project's files, checks and notes show on these rows (Design gate MF3).
import { describe, expect, test } from "vitest";
import { resetProjectCaches, type ProjectCaches } from "../src/renderer/project-caches.ts";

function filled(projectId: string): ProjectCaches {
  return {
    projectId,
    timeline: { project: { root: "/a", store: "/a/.tm" }, entries: [] } as unknown as ProjectCaches["timeline"],
    selected: "cp-0002",
    drawer: true,
    changes: new Map([["cp-0002", ["price.js"]]]),
    storedChecks: new Map([["cp-0002 PASS", null]]),
    deployChips: new Map([["cp-0002", "<span>Ready</span>"]]),
    notes: new Map([["cp-0002", { title: "Pricing", note: "", pinned: true, updated: "2026-10-25T07:00:00Z" }]]),
    journalFilter: "pinned",
    noteDraft: { id: "cp-0002", title: "x", note: "" },
    changesFor: "a:cp-0002",
  };
}

describe("switching projects", () => {
  test("clears every per-save-point cache, and changesFor, when the open project changes", () => {
    const s = filled("a");
    expect(resetProjectCaches(s, "b")).toBe(true);
    expect(s.projectId).toBe("b");
    expect(s.timeline).toBeNull();
    expect(s.selected).toBeNull();
    expect(s.drawer).toBe(false);
    for (const m of [s.changes, s.storedChecks, s.notes, s.deployChips]) expect(m.size).toBe(0);
    expect(s.changesFor).toBe("");
    expect(s.journalFilter).toBe("all");
    expect(s.noteDraft).toBeNull();
  });

  test("leaves them when the same project stays open, and clears them when the last one is removed", () => {
    const s = filled("a");
    expect(resetProjectCaches(s, "a")).toBe(false);
    expect(s.changes.get("cp-0002")).toEqual(["price.js"]);
    const gone = filled("a");
    expect(resetProjectCaches(gone, null)).toBe(true);
    expect(gone.projectId).toBeNull();
    expect(gone.changes.size).toBe(0);
  });
});
