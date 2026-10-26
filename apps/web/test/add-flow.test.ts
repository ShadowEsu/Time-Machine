import { describe, expect, test } from "vitest";
import { ADD_STEPS, AUTO_SAVE_LABEL, autoSaveRow, checkStepCopy, firstCheckChoice, folderWhenChoices, purposeCards } from "../src/renderer/add-flow.ts";
import { legendItems, projectStatus } from "../src/renderer/status.ts";

describe("the Add flow", () => {
  test("asks what to protect first, with four choices, and research says it is backups of your own files", () => {
    // Four short labels, so the stepper fits on one line.
    expect([...ADD_STEPS]).toEqual(["What", "Folder", "Check", "When"]);
    const html = purposeCards(null, false);
    for (const v of ["code", "documents", "research", "agents"]) expect(html).toContain(`data-v="${v}"`);
    expect(html).not.toContain('data-v="other"');
    expect(html).toContain("Backups of your own files on this computer.");
    // No health or clinical claims anywhere in the choices.
    expect(html).not.toMatch(/medical|clinical|patient|health|HIPAA/i);
  });

  test("a check is required for code and optional for the rest", () => {
    expect(checkStepCopy("code", "app").skip).toBeNull();
    expect(checkStepCopy("documents", "notes").skip?.title).toBe("Skip the check and save versions");
    expect(checkStepCopy("documents", "notes").heading).toBe("Check notes, or only save versions?");
    expect(checkStepCopy("research", "trial").lede).toContain("a run");
    expect(firstCheckChoice("code", "")).toBe("custom");
    expect(firstCheckChoice("code", "npm test")).toBe("detected");
    expect(firstCheckChoice("documents", "")).toBe("none");
    expect(firstCheckChoice("research", "pytest")).toBe("detected");
  });

  test("a folder that only saves versions never offers a check or calls a version working", () => {
    const pts = [{ id: "cp-0001", verdict: null, createdAt: new Date().toISOString(), note: "First save point", trigger: "app", agent: null }];
    const s = projectStatus(pts, null, false);
    // Its save state, in the words Overview and the rail use: "Saved 2:16 AM."
    expect(s.head).toMatch(/^Saved \d{1,2}:\d{2}(:\d{2})?\s?[AP]M\.$/);
    expect(`${s.voice} ${s.body}`).not.toMatch(/saved at/i);
    expect(s.primary.act).toBe("save");
    expect(s.secondary).toBeNull();
    expect(`${s.head} ${s.body}`).not.toMatch(/\bworks\b/i);
    // With a check, the same save point is "Not checked yet" and its step is Check it works.
    expect(projectStatus(pts).primary.act).toBe("check");
  });

  test("a folder's when-to-save step offers saving on change or only on Save now, and never the Claude Code lines", () => {
    const on = folderWhenChoices("change", "⌘S");
    expect(AUTO_SAVE_LABEL).toBe("Save when files change, while Time Machine is open");
    expect(on).toContain(AUTO_SAVE_LABEL);
    expect(on).toContain("Only when I press Save now");
    expect(on).toMatch(/data-v="change" checked/);
    expect(on).not.toMatch(/data-v="off" checked/);
    expect(folderWhenChoices("off", "⌘S")).toMatch(/data-v="off" checked/);
    expect(on).not.toMatch(/Claude Code|hook|Planned/i);
    // A Git project keeps its Claude Code row and gets the same switch, now built, in place of the planned row.
    const row = autoSaveRow("off");
    expect(row).toContain(AUTO_SAVE_LABEL);
    expect(row).toContain('data-v="change"');
    expect(autoSaveRow("change")).toContain('data-v="off"');
    expect(row).not.toContain("Planned");
  });

  test("the ruler's legend names only Saved for a project with no check, and every shape it draws otherwise", () => {
    expect(legendItems(false, [null, null])).toEqual([{ v: null, word: "Saved" }]);
    expect(legendItems(true, [null]).map((x) => x.word)).toEqual(["Works", "Broken", "Not checked yet"]);
    expect(legendItems(true, [null, "ERROR"]).map((x) => x.v)).toEqual(["PASS", "FAIL", null, "ERROR"]);
  });
});
