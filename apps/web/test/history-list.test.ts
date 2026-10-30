// History as a list and a preview: what is selected first, what the status line says, where the keys go and what
// changed since a save point.
import { describe, expect, test } from "vitest";
import { brokeAt, changedSince, defaultPick, folderSteps, folderWord, foldRepeats, listMove, statusLine, type ListPoint } from "../src/renderer/history-list.ts";

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

describe("a save point with no message", () => {
  test("is named by its time in words, never by an internal number", async () => {
    const { namePoint } = await import("../src/shared/format.ts");
    const at = new Date();
    at.setHours(2, 58, 48, 0);
    const c = { id: "cp-0003", createdAt: at.toISOString() };
    const twin = { id: "cp-0004", createdAt: at.toISOString() };
    const n = namePoint(c, [c, twin], "", at);
    expect(n.name).toMatch(/^Save at 2:58:48\sAM$/);
    expect(n.name).not.toContain("#");
  });
});

describe("folder commands after a bring back (L364 r5, sequence S3)", () => {
  test("a side-branch commit, no stash; the same text on screen and copied; going back from a branch or a detached HEAD", () => {
    const f = folderSteps("~/code/marigold-tips", "tm/recover/cp-0003", "abc123", "cp-0003", { branch: "main", sha: "def456" });
    expect(f.commands).toBe([
      "cd ~/'code/marigold-tips' &&",
      "git branch use-cp-0003 tm/recover/cp-0003 &&",
      "git -c core.hooksPath=/dev/null switch -c tm/folder-before/cp-0003 &&",
      "git add -A &&",
      'git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name="Time Machine" -c user.email=tm@localhost commit -q --allow-empty -m "tm: folder before using cp-0003" &&',
      "git -c core.hooksPath=/dev/null switch use-cp-0003",
    ].join("\n"));
    expect(f.back).toBe("cd ~/'code/marigold-tips' && git -c core.hooksPath=/dev/null switch tm/folder-before/cp-0003 && git reset -q --soft main && git -c core.hooksPath=/dev/null switch main && git reset -q && git branch -D tm/folder-before/cp-0003 && git update-ref -d refs/heads/use-cp-0003 abc123");
    const g = folderSteps("/opt/it's here", "tm/recover/cp-0003-2", "abc123", "cp-0003", { branch: null, sha: "def456" });
    expect(g.commands.split("\n")[0]).toBe("cd '/opt/it'\\''s here' &&");
    expect(g.commands.split("\n")[1]).toBe("git branch use-cp-0003 tm/recover/cp-0003-2 &&");
    expect(g.back).toContain("git reset -q --soft def456 && git -c core.hooksPath=/dev/null switch --detach def456 &&");
  });
  test("secret-looking files are left out by literal pathspec and named; a tracked secret path means no block (Security L364)", () => {
    const was = { branch: "main", sha: "def456" };
    const one = folderSteps("~/tips", "tm/recover/cp-0003", "abc123", "cp-0003", was, { excluded: [".env"], tracked: [] });
    expect(one.commands.split("\n")[3]).toBe("git add -A -- . ':(exclude,literal).env' &&");
    expect(one.left).toBe("We left out .env (looks like a secret). It stays in your folder, untouched.");
    const two = folderSteps("~/tips", "tm/recover/cp-0003", "abc123", "cp-0003", was, { excluded: [".env", "it's notes.txt"], tracked: [] });
    expect(two.commands.split("\n")[3]).toBe("git add -A -- . ':(exclude,literal).env' ':(exclude,literal)it'\\''s notes.txt' &&");
    expect(two.left).toBe("We left out .env and it's notes.txt (they look like secrets). They stay in your folder, untouched.");
    const blocked = folderSteps("~/tips", "tm/recover/cp-0003", "abc123", "cp-0003", was, { excluded: [], tracked: ["config/prod.env"] });
    expect(blocked.commands).toBe("");
    expect(blocked.back).toBe("");
    expect(blocked.blocked).toBe("This version tracks config/prod.env, which looks secret. Move your copy somewhere safe first.");
    expect(one.end).toBe("You end on a new branch, use-cp-0003, made from the working version. Your old branch is unchanged.");
    expect(one.onUse).toBe("Your folder is on use-cp-0003, the working version. Your broken work is on the branch tm/folder-before/cp-0003.");
    expect(one.why).toHaveLength(6);
    expect(one.hooks).toBe("");
    expect(folderSteps("~/tips", "tm/recover/cp-0003", "abc123", "cp-0003", was, { excluded: [], tracked: [], hooks: true }).hooks).toBe("These steps skip your repo’s commit hooks.");
    expect(one.local).toBe("tm/folder-before/cp-0003 is a local safety branch. Don’t push it or merge it. To get your work back, run the go-back line.");
    expect(folderSteps("~/tips", "tm/recover/cp-0003", "abc123", "cp-0003", was).commands.split("\n")[3]).toBe("git add -A &&");
  });
  test("a folder under home keeps the tilde outside the quotes; elsewhere the whole path is quoted", () => {
    expect(folderWord("~/my tips")).toBe("~/'my tips'");
    expect(folderWord("/Volumes/work/tips")).toBe("'/Volumes/work/tips'");
  });
});
