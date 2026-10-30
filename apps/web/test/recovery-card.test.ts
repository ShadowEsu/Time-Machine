// History's recovery card (option C): which step is current, the two Git commands that keep a bring back, and the
// "changed since" line. No browser needed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { changedSince, guideStep, keepCommands, pathsLine, stepState } from "../src/renderer/recovery-card.ts";

describe("recovery card steps", () => {
  test("Bring back is current until it is back, then Try it, then Keep it or undo; Keep it ends the card", () => {
    expect(guideStep({ brought: false, tried: false, kept: false })).toBe(1);
    expect(guideStep({ brought: true, tried: false, kept: false })).toBe(2);
    expect(guideStep({ brought: true, tried: true, kept: false })).toBe(3);
    expect(guideStep({ brought: true, tried: true, kept: true })).toBe(0);
    expect(guideStep({ brought: true, tried: false, kept: true })).toBe(0);
  });

  test("a step before the current one is done, the current one is now, the rest wait; all are done once kept", () => {
    expect([1, 2, 3].map((s) => stepState(s as 1 | 2 | 3, 1))).toEqual(["now", "later", "later"]);
    expect([1, 2, 3].map((s) => stepState(s as 1 | 2 | 3, 2))).toEqual(["done", "now", "later"]);
    expect([1, 2, 3].map((s) => stepState(s as 1 | 2 | 3, 3))).toEqual(["done", "done", "now"]);
    expect([1, 2, 3].map((s) => stepState(s as 1 | 2 | 3, 0))).toEqual(["done", "done", "done"]);
  });
});

describe("keep commands", () => {
  test("restore every tracked file from the recovery branch, then one commit named for the save point in plain characters", () => {
    expect(keepCommands("tm/recover/cp-0003", "“Added dark mode”")).toEqual([
      "git restore --source=tm/recover/cp-0003 --staged --worktree -- .",
      'git commit -m "Bring back Added dark mode"',
    ]);
    expect(keepCommands("tm/recover/cp-0003", "")[1]).toBe('git commit -m "Bring back the version that works"');
    // Nothing a shell would expand or end the message with.
    expect(keepCommands("tm/recover/cp-0009", 'fix "quotes" $HOME `id` & more')[1]).toBe('git commit -m "Bring back fix quotes HOME id more"');
  });

  test("run in a real repository, they make the folder match the branch, files added since go, untracked files stay", () => {
    const dir = mkdtempSync(join(tmpdir(), "tm-keep-"));
    const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "tips.js"), "works\n");
    git("add", ".");
    git("commit", "-q", "-m", "Added dark mode");
    git("branch", "tm/recover/cp-0001");
    writeFileSync(join(dir, "tips.js"), "broken\n");
    writeFileSync(join(dir, "extra.js"), "added later\n");
    git("add", ".");
    git("commit", "-q", "-m", "Broke it");
    writeFileSync(join(dir, "notes.txt"), "not tracked\n");
    for (const cmd of keepCommands("tm/recover/cp-0001", "“Added dark mode”")) {
      const [, ...args] = cmd.match(/"[^"]*"|\S+/g)!.map((a) => a.replace(/^"|"$/g, ""));
      git(...args);
    }
    expect(readFileSync(join(dir, "tips.js"), "utf8")).toBe("works\n");
    expect(git("ls-files").trim().split("\n")).toEqual(["tips.js"]);
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("not tracked\n");
    expect(git("log", "-1", "--format=%s").trim()).toBe("Bring back Added dark mode");
    expect(git("diff", "tm/recover/cp-0001", "HEAD", "--stat").trim()).toBe("");
  });
});

describe("changed since", () => {
  test("every path changed after the save point, each once, first seen first", () => {
    const changes = new Map([["cp-4", ["src/tips.js", "package.json"]], ["cp-5", ["src/tips.js", "README.md"]], ["cp-6", []]]);
    expect(changedSince(changes, ["cp-4", "cp-5", "cp-6", "cp-7"])).toEqual(["src/tips.js", "package.json", "README.md"]);
    expect(changedSince(changes, [])).toEqual([]);
  });

  test("a short list names two and counts the rest", () => {
    expect(pathsLine([])).toBe("");
    expect(pathsLine(["a.js"])).toBe("a.js");
    expect(pathsLine(["a.js", "b.js"])).toBe("a.js, b.js");
    expect(pathsLine(["a.js", "b.js", "c.js", "d.js"])).toBe("a.js, b.js and 2 more");
  });
});
