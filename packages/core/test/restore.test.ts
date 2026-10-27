// Dogfood 25 Oct (writer#10, "Restore one file") and the customer review ("I just want my file back"):
// one file or folder comes back from a save point into the live folder, with a save first so nothing is lost.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";

const OLD = new Date("2020-01-02T03:04:05Z");

/** A plain folder of chapters with its own store, outside any Git repository. */
function thesis(): { root: string; dir: string; ctx: tm.Ctx } {
  const root = tempDir("restore");
  const dir = join(root, "Thesis");
  const home = join(root, "store");
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "chapter-1.md"), "# One\n");
  writeFileSync(join(dir, "notes", "reading.md"), "Knuth\n");
  writeFileSync(join(dir, "notes", "todo.md"), "write\n");
  utimesSync(join(dir, "chapter-1.md"), OLD, OLD);
  const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
  tm.protect(ctx);
  return { root, dir, ctx };
}

const read = (path: string): string => readFileSync(path, "utf8");

describe("restorePaths in a plain folder", () => {
  test("one file comes back with its saved text and today's time (so build tools see it changed); the save made first holds the edit", async () => {
    const { root, dir, ctx } = thesis();
    await tm.checkpoint(ctx, { note: "first" });
    writeFileSync(join(dir, "chapter-1.md"), "garbage\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["chapter-1.md"]);
    expect(r).toMatchObject({ id: "cp-0001", dryRun: false, restored: ["chapter-1.md"], kept: [], skipped: [], savedBefore: "cp-0002", diff: { added: 0, changed: 1, same: 0 } });
    expect(r.note).toBeUndefined();
    expect(read(join(dir, "chapter-1.md"))).toBe("# One\n");
    expect(statSync(join(dir, "chapter-1.md")).mtimeMs).toBeGreaterThan(Date.now() - 60_000);

    const before = (await tm.timeline(ctx)).checkpoints.find((c) => c.id === "cp-0002");
    expect(before?.trigger).toBe("before-restore");
    expect((await tm.log(ctx)).entries.find((e) => e.action === "restore")).toMatchObject({ target: "cp-0001", result: "1 path" });
    const look = await tm.open(ctx, "cp-0002", { dir: join(root, "look") });
    expect(read(join(look.dir, "chapter-1.md"))).toBe("garbage\n");
  });

  test.skipIf(process.platform === "win32")("a file comes back with its saved mode, whatever the umask, so a dry run then says it is the same", async () => {
    const { dir, ctx } = thesis();
    chmodSync(join(dir, "chapter-1.md"), 0o664);
    await tm.checkpoint(ctx);
    rmSync(join(dir, "chapter-1.md"));
    const old = process.umask(0o022);
    try {
      expect((await tm.restorePaths(ctx, "cp-0001", ["chapter-1.md"])).restored).toEqual(["chapter-1.md"]);
    } finally {
      process.umask(old);
    }
    expect(statSync(join(dir, "chapter-1.md")).mode & 0o777).toBe(0o664);
    expect((await tm.restorePaths(ctx, "cp-0001", ["chapter-1.md"], { dryRun: true })).diff).toEqual({ added: 0, changed: 0, same: 1 });
  });

  test("a file whose version now could not be saved first (it looks secret) is not replaced", async () => {
    const { dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    writeFileSync(join(dir, "chapter-1.md"), "token ghp_abcdefghijklmnopqrstuvwxyz0123\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["chapter-1.md"]);
    expect(r).toMatchObject({ restored: [], savedBefore: "cp-0002", skipped: ["chapter-1.md: the version there now could not be saved first (cp-0002 left it out), so it was not replaced"] });
    expect(read(join(dir, "chapter-1.md"))).toContain("ghp_");
  });

  test("a folder path brings back every saved file under it and keeps a new one", async () => {
    const { dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    writeFileSync(join(dir, "notes", "reading.md"), "Knuth, edited\n");
    rmSync(join(dir, "notes", "todo.md"));
    writeFileSync(join(dir, "notes", "extra.md"), "new\n");
    writeFileSync(join(dir, "chapter-1.md"), "outside the folder asked for\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["notes/"]);
    expect(r.restored).toEqual(["notes/reading.md", "notes/todo.md"]);
    expect(r.kept).toEqual(["notes/extra.md"]);
    expect(r.diff).toEqual({ added: 1, changed: 1, same: 0 });
    expect(read(join(dir, "notes", "reading.md"))).toBe("Knuth\n");
    expect(read(join(dir, "notes", "todo.md"))).toBe("write\n");
    expect(read(join(dir, "notes", "extra.md"))).toBe("new\n");
    expect(read(join(dir, "chapter-1.md"))).toBe("outside the folder asked for\n");
  });

  test("a path not in the save point, outside the folder, or a secrets file is skipped by name", async () => {
    const { root, dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    writeFileSync(join(dir, "chapter-1.md"), "garbage\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["nope.md", "../outside.md", "/etc/hosts", ".env", "chapter-1.md"]);
    expect(r.restored).toEqual(["chapter-1.md"]);
    expect(r.skipped).toEqual([
      "nope.md: not in cp-0001",
      "../outside.md: not a path inside the project",
      "/etc/hosts: not a path inside the project",
      ".env: a secrets file, which Time Machine never saves or writes",
    ]);
    expect(existsSync(join(root, "outside.md"))).toBe(false);

    const none = await tm.restorePaths(ctx, "cp-0001", ["nope.md"]);
    expect(none).toMatchObject({ restored: [], savedBefore: null, skipped: ["nope.md: not in cp-0001"] });
    expect((await tm.timeline(ctx)).checkpoints.map((c) => c.id)).toEqual(["cp-0001", "cp-0002"]);
  });

  test("a symbolic link in the way is never followed", async () => {
    const { root, dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    mkdirSync(join(root, "elsewhere"));
    rmSync(join(dir, "notes"), { recursive: true });
    symlinkSync(join(root, "elsewhere"), join(dir, "notes"));

    const r = await tm.restorePaths(ctx, "cp-0001", ["notes"]);
    expect(r.restored).toEqual([]);
    expect(r.skipped).toEqual([
      "notes/reading.md: a symbolic link is in the way, so it was not written",
      "notes/todo.md: a symbolic link is in the way, so it was not written",
    ]);
    expect(existsSync(join(root, "elsewhere", "reading.md"))).toBe(false);
  });

  test("a dry run says the same and writes nothing", async () => {
    const { dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    writeFileSync(join(dir, "chapter-1.md"), "garbage\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["chapter-1.md", "notes"], { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, restored: ["chapter-1.md"], savedBefore: null, diff: { added: 0, changed: 1, same: 2 } });
    expect(read(join(dir, "chapter-1.md"))).toBe("garbage\n");
    expect((await tm.timeline(ctx)).checkpoints).toHaveLength(1);
    expect((await tm.log(ctx)).entries.some((e) => e.action === "restore")).toBe(false);
  });

  test("a folder that is gone is refused, pointing at recover", async () => {
    const { root, dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    renameSync(dir, join(root, "moved"));
    await expect(tm.restorePaths(ctx, "cp-0001", ["chapter-1.md"])).rejects.toThrow(/^Can't find .*Thesis; use recover to a chosen folder/);
  });
});

describe("restorePaths and files Git converts", () => {
  test("a file Git stores converted (line endings here, Git LFS alike) is named for that, not as one the save left out (Security F12)", async () => {
    const root = tempDir("restore-eol");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, ".gitattributes"), "notes.txt text eol=crlf\n");
    writeFileSync(join(dir, "notes.txt"), "one\r\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    await tm.checkpoint(ctx);
    writeFileSync(join(dir, "notes.txt"), "two\r\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["notes.txt"]);
    expect(r.restored).toEqual([]);
    expect(r.skipped).toEqual([
      "notes.txt: Git stores this file converted (its line endings, or Git LFS), so the version there now can't be checked against the save made first (cp-0002), and it was not replaced. tm open cp-0001 gives you the saved copy",
    ]);
    expect(read(join(dir, "notes.txt"))).toBe("two\r\n");
  });
});

describe("restorePaths in a Git project", () => {
  test("writes the files and commits nothing", async () => {
    const root = tempDir("restore-git");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "a\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    writeFileSync(join(dir, "draft.txt"), "untracked draft\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    await tm.checkpoint(ctx);
    const head = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "a.txt"), "garbage\n");
    rmSync(join(dir, "draft.txt"));

    const r = await tm.restorePaths(ctx, "cp-0001", ["a.txt", "draft.txt"]);
    expect(r).toMatchObject({ restored: ["a.txt", "draft.txt"], diff: { added: 1, changed: 1, same: 0 }, savedBefore: "cp-0002", note: "Files written; nothing committed." });
    expect(read(join(dir, "a.txt"))).toBe("a\n");
    expect(read(join(dir, "draft.txt"))).toBe("untracked draft\n");
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("");
    expect(git(dir, "status", "--porcelain")).toBe("?? draft.txt");

    writeFileSync(join(dir, "a.txt"), "garbage\n");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "second");
    await tm.restorePaths(ctx, "cp-0001", ["a.txt"]);
    expect(git(dir, "status", "--porcelain", "a.txt")).toBe("M a.txt");
    expect(git(dir, "rev-list", "--count", "HEAD")).toBe("2");

    const hooks = await tm.restorePaths(ctx, "cp-0001", [".git/hooks/pre-commit", ".git", "sub/.git/config"]);
    expect(hooks).toMatchObject({ restored: [], savedBefore: null });
    expect(hooks.skipped).toEqual([".git/hooks/pre-commit", ".git", "sub/.git/config"].map((x) => `${x}: inside .git, which Time Machine never writes`));
  });

  test("a folder brought back never writes a secrets file or a config file inside it, though the save point has both (Security T1)", async () => {
    const root = tempDir("restore-git-t1");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(dir, "settings"), { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [settings/app.conf]\n");
    writeFileSync(join(dir, "settings", "app.conf"), "MODE=saved\n");
    writeFileSync(join(dir, "settings", ".env"), "TOKEN=saved\n");
    writeFileSync(join(dir, "settings", "readme.md"), "saved\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    await tm.checkpoint(ctx);
    for (const f of ["app.conf", ".env", "readme.md"]) writeFileSync(join(dir, "settings", f), "now\n");

    const r = await tm.restorePaths(ctx, "cp-0001", ["settings"]);
    expect(r.restored).toEqual(["settings/readme.md"]);
    expect(r.skipped).toEqual([
      "settings/.env: a secrets file, which Time Machine never saves or writes",
      "settings/app.conf: a config file: its keys are recorded, not its text, so it was not written",
    ]);
    expect(read(join(dir, "settings", "readme.md"))).toBe("saved\n");
    expect(read(join(dir, "settings", ".env"))).toBe("now\n");
    expect(read(join(dir, "settings", "app.conf"))).toBe("now\n");
  });
});
