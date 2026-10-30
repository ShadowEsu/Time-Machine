// Pure helpers the project screens read: damaged save points, change summaries, Git rows and day groups.
import { describe, expect, test } from "vitest";
import { changeSummary, checkReason, damagedReason, gitLine, isDamagedReason, newestByTime } from "../src/renderer/status.ts";

describe("a damaged save point", () => {
  test("is told from a check that crashed by the engine's integrity words", () => {
    expect(isDamagedReason("cp-0003 failed its integrity check. Its Git ref was moved.")).toBe(true);
    expect(isDamagedReason("The Git commit for cp-0003 is missing from this repository.")).toBe(true);
    expect(isDamagedReason("The check timed out after 600 s.")).toBe(false);
  });

  test("takes the engine's sentence, else the shape an unreadable save point has in the timeline", () => {
    const whole = { createdAt: "2026-10-25T22:00:00.000Z", trigger: "app", note: "x", verdict: null };
    expect(damagedReason(whole)).toBeNull();
    expect(damagedReason({ ...whole, damaged: "The saved copy of f3.txt is gone from the store." })).toBe("The saved copy of f3.txt is gone from the store.");
    expect(damagedReason({ createdAt: "", trigger: "", note: "cp-0002 failed its integrity check.", verdict: "ERROR" })).toBe("cp-0002 failed its integrity check.");
  });
});

describe("why a check could not start", () => {
  test("no check set points to the app's own Settings, not to a file and a key", () => {
    // The engine's sentence (packages/core/src/verify.ts) is for the tm command line.
    const shown = checkReason("No check is set up. Add verify.command to timemachine.yml, for example npm test.");
    expect(shown).toBe("No check is set up yet. Set one in Settings, under Check.");
    expect(shown).not.toMatch(/verify\.command|timemachine\.yml/);
  });

  test("every other reason is said as the engine wrote it", () => {
    const folder = "No check is set up. A check is optional for a plain folder. Set one, for example a script that opens your files, to test a save point in a safe copy.";
    expect(checkReason(folder)).toBe(folder);
    expect(checkReason("The check timed out after 600 s.")).toBe("The check timed out after 600 s.");
  });
});

describe("what a save point changed, in a few words", () => {
  const none = { added: [], removed: [], changed: [] };
  const notes = Array.from({ length: 300 }, (_, i) => `notes/n-${i}.md`);

  test("one kind says how many, and where when it is one folder", () => {
    const all = [".DS_Store", ...Array.from({ length: 309 }, (_, i) => `f-${i}.md`)];
    expect(changeSummary({ ...none, removed: all })).toBe("309 files deleted");
    expect(changeSummary({ ...none, added: notes })).toBe("300 files added in notes/");
    expect(changeSummary({ ...none, changed: ["drafts/chapter-2.md"] })).toBe("chapter-2.md changed");
    expect(changeSummary(none)).toBe("");
    expect(changeSummary({ ...none, changed: [".DS_Store"] })).toBe("");
  });

  test("mixed changes put the biggest event first and name single files", () => {
    expect(changeSummary({ added: [...notes, "chapter-3-final.md"], removed: ["chapter-3.md"], changed: ["chapter-2.md"] }))
      .toBe("300 added in notes/, chapter-3.md deleted, chapter-3-final.md added and 1 more");
    expect(changeSummary({ added: ["a.md"], removed: [], changed: ["b.md", "c.md"] })).toBe("2 changed, a.md added");
  });
});

describe("day groups", () => {
  test("follow the time each save point was made, not its number, so one date is one group", () => {
    const pts = [
      { id: "cp-0001", createdAt: "2026-10-25T10:00:00.000Z" },
      { id: "cp-0002", createdAt: "2026-10-18T10:00:00.000Z" },
      { id: "cp-0003", createdAt: "2026-10-25T11:00:00.000Z" },
      { id: "cp-0004", createdAt: "2026-10-25T11:00:00.000Z" },
    ];
    expect(newestByTime(pts).map((c) => c.id)).toEqual(["cp-0004", "cp-0003", "cp-0001", "cp-0002"]);
  });
});

describe("Git rows", () => {
  const cov = (captured: string[]) => ({ captured, restorable: [], missing: [], manual: [] });
  const c = { id: "cp-0003", head: "497e8b8aaaaaaa", branch: "main", subject: "Tweak discount tier 29", coverage: cov(["Code: commit e2e63c7 on main, including 2 uncommitted changes"]) };

  test("show the person's HEAD, subject and branch, never the snapshot commit", () => {
    expect(gitLine(c, "git")).toBe("main · 497e8b8 Tweak discount tier 29 + 2 uncommitted");
    expect(gitLine(c, "git")).not.toContain("e2e63c7");
  });

  test("say uncommitted only when tracked files changed, and detached when there is no branch", () => {
    expect(gitLine({ ...c, branch: null, subject: null, coverage: cov(["Code: commit e5dd44b", "Files: 3 files not in Git"]) }, "git")).toBe("detached at 497e8b8");
  });

  test("a plain folder shows only its id, never a branch or a commit", () => {
    expect(gitLine({ ...c, branch: "master" }, "folder")).toBe("cp-0003");
  });
});
