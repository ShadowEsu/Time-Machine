import { describe, expect, test } from "vitest";
import { ADD_FULL, ADD_STEPS, AUTO_SAVE_LABEL, addFullCard, autoSaveRow, buildOffered, checkStepCopy, defaultAutoSave, firstCheckChoice, folderWhenChoices, foundBefore, pathProblem, purposeCards, skipNote } from "../src/renderer/add-flow.ts";
import { legendItems, projectStatus } from "../src/renderer/status.ts";

describe("the Add flow", () => {
  test("asks what to protect first, with four choices and no stray line under one of them", () => {
    // Four short labels, so the stepper fits on one line.
    expect([...ADD_STEPS]).toEqual(["What", "Folder", "Check", "When"]);
    const html = purposeCards(null, false);
    for (const v of ["code", "documents", "research", "agents"]) expect(html).toContain(`data-v="${v}"`);
    expect(html).not.toContain('data-v="other"');
    expect(html).not.toContain("Backups of your own files");
    expect(html).not.toContain("ad-own");
    // No health or clinical claims anywhere in the choices.
    expect(html).not.toMatch(/medical|clinical|patient|health|HIPAA/i);
  });

  test("a code project with no tests may only save versions, and is told that means no Works or Broken", () => {
    const code = checkStepCopy("code", "app");
    expect(code.skip.title).toBe("No tests yet: only save versions");
    // Exactly true after Try it now: the save point it checked keeps its verdict; only the ones from now on have none.
    expect(code.skip.note).toBe("From now on, save points are saved without a check, so they are not called Works or Broken. You compare versions and put files back by hand. Add a check later in Settings.");
    expect(code.skip.note).not.toMatch(/never called/);
    expect(checkStepCopy("documents", "notes").skip.title).toBe("Skip the check and save versions");
    expect(checkStepCopy("documents", "notes").heading).toBe("Check notes, or only save versions?");
    expect(checkStepCopy("research", "trial").lede).toContain("a run");
    expect(firstCheckChoice("code", "")).toBe("custom");
    expect(firstCheckChoice("code", "npm test")).toBe("detected");
    expect(firstCheckChoice("documents", "")).toBe("none");
    expect(firstCheckChoice("research", "pytest")).toBe("detected");
  });

  test("no tests yet on a timemachine.yml that had a check says it empties it, and on a Git project that Git will show the change", () => {
    const note = checkStepCopy("code", "app").skip.note;
    expect(skipNote(note, false, "git")).toBe(note);
    expect(skipNote(note, true, "git")).toBe(`${note} This empties the check in your timemachine.yml (a change Git will show); Back puts it back.`);
    // A plain folder hears no Git words.
    expect(skipNote(note, true, "folder")).toBe(`${note} This empties the check in your timemachine.yml; Back puts it back.`);
    expect(skipNote(note, true, "folder")).not.toMatch(/\b(Git|commit|branch|repo)\b/);
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
    // A project whose check was taken away keeps its old verdicts in the legend; a save point without one is Saved.
    expect(legendItems(false, ["PASS", "FAIL", null]).map((x) => x.word)).toEqual(["Works", "Broken", "Saved"]);
    expect(legendItems(true, [null]).map((x) => x.word)).toEqual(["Works", "Broken", "Not checked yet"]);
    expect(legendItems(true, [null, "ERROR"]).map((x) => x.v)).toEqual(["PASS", "FAIL", null, "ERROR"]);
  });

  test("the folder field takes ~ and says plainly what is missing; the engine's own sentences cover the rest", () => {
    expect(pathProblem("")).toBe("Enter a folder path.");
    expect(pathProblem("   ")).toBe("Enter a folder path.");
    expect(pathProblem("~")).toBeNull();
    expect(pathProblem("~/Documents/Thesis")).toBeNull();
    expect(pathProblem("/Users/me/Thesis")).toBeNull();
    expect(pathProblem("C:\\Users\\me")).toBeNull();
    expect(pathProblem("Documents/Thesis")).toBe("Enter the whole path to the folder, starting with / or ~/.");
  });

  test("Build it is offered only when package.json has a build script, and never twice", () => {
    expect(buildOffered("code", [], "")).toBe(false);
    expect(buildOffered("code", ["test", "lint"], "npm test")).toBe(false);
    expect(buildOffered("code", ["test", "build"], "npm test")).toBe(true);
    expect(buildOffered("code", ["build"], "npm run build")).toBe(false);
    expect(buildOffered("documents", ["build"], "")).toBe(false);
  });

  test("a folder that already has history says how much was found, in the project's own unit", () => {
    expect(foundBefore(0, "documents")).toBeNull();
    expect(foundBefore(1, "documents")).toBe("Found 1 save point from before.");
    expect(foundBefore(7, "documents")).toBe("Found 7 save points from before.");
    expect(foundBefore(3, "research")).toBe("Found 3 runs from before.");
  });

  test("saving on change starts on for plain folders of documents, research and agent work, as the engine sets it", () => {
    expect(defaultAutoSave("folder", "documents")).toBe("change");
    expect(defaultAutoSave("folder", "research")).toBe("change");
    expect(defaultAutoSave("folder", "agents")).toBe("change");
    expect(defaultAutoSave("folder", "code")).toBe("off");
    expect(defaultAutoSave("git", "documents")).toBe("off");
  });

  test("a full free plan says so on step 1, with the way to Storage and to a key", () => {
    expect(ADD_FULL).toBe("Free plan full: remove one in Storage");
    const card = addFullCard(3);
    expect(card).toContain(ADD_FULL);
    expect(card).toContain('data-act="storage"');
    expect(card).toContain('data-act="plan"');
    expect(card).toContain("3 projects");
    // Disabled cards: nothing is offered that the engine would refuse at the end.
    expect(purposeCards(null, true)).toMatch(/data-act="ob-purpose"[^>]*disabled/);
  });
});
