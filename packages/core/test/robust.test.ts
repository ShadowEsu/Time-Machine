// Dogfood 25 Oct: a folder that was moved or deleted (writer#1,#2), two projects on one Git repository
// (dev#1,#2), skips that were silent (cli#1, cli#6, cli#25, writer#5), copies keep saved times and never
// hold system files (writer#27,#28), and a check that may not write outside its copy (dev#3).
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { SHADOW_GIT_DIR } from "../src/git.ts";
import { resolveProject } from "../src/project.ts";
import { blobPath, readManifest, writeManifest } from "../src/store.ts";

/** `secrets/<0xff>.env`: a name that isn't valid UTF-8, as Linux disks and Git allow. */
const FF_NAME = Buffer.concat([Buffer.from("secrets/"), Buffer.from([0xff]), Buffer.from(".env")]);

/** Runs Git with raw bytes in and out, for names that aren't valid UTF-8. */
function rawGit(dir: string, args: string[], input?: Buffer): Buffer {
  const r = spawnSync("git", args, { cwd: dir, input });
  if (r.status !== 0) throw new Error(`git ${args[0] ?? ""} failed: ${r.stderr.toString()}`);
  return r.stdout;
}

/** A plain folder of chapters with its own store, outside any Git repository. */
function thesis(): { root: string; dir: string; ctx: tm.Ctx; home: string } {
  const root = tempDir("robust");
  const dir = join(root, "Thesis");
  const home = join(root, "store");
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "chapter-1.md"), "# One\n");
  writeFileSync(join(dir, "notes", "reading.md"), "Knuth\n");
  const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
  tm.protect(ctx);
  return { root, dir, home, ctx };
}

/** A Git repository with one commit. */
function repo(name: string): { dir: string; ctx: tm.Ctx; home: string } {
  const root = tempDir(name);
  const dir = join(root, name);
  const home = join(root, "store");
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", ".");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
  return { dir, home, ctx: { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } } };
}

describe("a folder that was moved or deleted (writer#1,#2)", () => {
  test("its save points still list, open, and come back to a chosen folder; relink keeps the history", async () => {
    const { root, dir, ctx } = thesis();
    await tm.checkpoint(ctx, { note: "first" });
    writeFileSync(join(dir, "chapter-1.md"), "# One, edited\n");
    await tm.checkpoint(ctx, { note: "second" });
    renameSync(dir, join(root, "Thesis-moved"));

    const tl = await tm.timeline(ctx);
    expect(tl.missing).toBe(true);
    expect(tl.checkpoints.map((c) => [c.id, c.note, c.damaged])).toEqual([["cp-0001", "first", undefined], ["cp-0002", "second", undefined]]);

    const opened = await tm.open(ctx, "cp-0001", { dir: join(root, "look") });
    expect(opened.missing).toEqual([]);
    expect(readFileSync(join(root, "look", "chapter-1.md"), "utf8")).toBe("# One\n");

    mkdirSync(join(root, "picked"));
    const r = await tm.recover(ctx, "cp-0002", { dest: join(root, "picked") });
    expect(r.savedBefore).toBeNull();
    expect(r.missing).toEqual([]);
    expect(r.copyDir).toBe(join(root, "picked", "Thesis-recovered-cp-0002"));
    expect(readFileSync(join(r.copyDir, "notes", "reading.md"), "utf8")).toBe("Knuth\n");
    expect(existsSync(dir)).toBe(false);

    await expect(tm.checkpoint(ctx)).rejects.toThrow(/is not there any more, so nothing was saved/);
    await expect(tm.recover(ctx, "cp-0002", { dest: join(root, "picked", "nope") })).rejects.toMatchObject({ kind: "usage" });

    const moved = join(root, "Thesis-moved");
    const linked = await tm.relinkProject(ctx, moved);
    expect(linked).toMatchObject({ kind: "folder" });
    expect(linked.root.endsWith("Thesis-moved")).toBe(true);
    const at = { ...ctx, cwd: moved };
    writeFileSync(join(moved, "chapter-2.md"), "# Two\n");
    const saved = await tm.checkpoint(at, { note: "after the move" });
    expect(saved.checkpoint.id).toBe("cp-0003");
    expect((await tm.timeline(at)).checkpoints.map((c) => c.id)).toEqual(["cp-0001", "cp-0002", "cp-0003"]);
    await expect(tm.timeline(ctx)).rejects.toThrow(/does not exist/);
    expect((await tm.log(at)).entries.at(-2)?.action).toBe("relink");
  });

  test("relink checks the new path like a new project", async () => {
    const { root, dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    writeFileSync(join(root, "a-file"), "x");
    await expect(tm.relinkProject(ctx, join(root, "a-file"))).rejects.toThrow("is a file, not a folder");
    await expect(tm.relinkProject(ctx, join(root, "nowhere"))).rejects.toThrow("does not exist");
    await expect(tm.relinkProject(ctx, "relative/path")).rejects.toThrow("is not a full path");
    await expect(tm.relinkProject(ctx, dir)).rejects.toThrow("is already at");
    const other = join(root, "Other");
    mkdirSync(other);
    tm.protect({ ...ctx, cwd: other });
    await expect(tm.relinkProject(ctx, other)).rejects.toThrow("already has its own history");
  });

  test("every project in the store is listed, a gone folder too", async () => {
    const { root, dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    rmSync(dir, { recursive: true });
    const list = tm.storeProjects(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Thesis", kind: "folder", savePoints: 1, missing: true });
    expect(list[0]?.sizeBytes).toBeGreaterThan(0);
    expect(list[0]?.lastSaved).toMatch(/^\d{4}-/);
    // A folder added but never saved is listed too: the store records it on the first write.
    const fresh = join(root, "Fresh");
    mkdirSync(fresh);
    tm.protect({ ...ctx, cwd: fresh });
    expect(tm.storeProjects(ctx).map((p) => [p.name, p.savePoints])).toContainEqual(["Fresh", 0]);
  });
});

describe("two projects on one Git repository (dev#1,#2)", () => {
  test("a second worktree of a protected repository is refused, with both paths named", async () => {
    const { dir, ctx } = repo("edge");
    await tm.init(ctx, { approve: false });
    await tm.checkpoint(ctx);
    const wt = `${dir}-wt`;
    git(dir, "worktree", "add", "-q", wt);
    const other = { ...ctx, cwd: wt };
    const sentence = /edge-wt shares its Git repository with .*edge, which Time Machine already protects\. Protect one of them\./;
    await expect(tm.init(other)).rejects.toThrow(sentence);
    await expect(tm.checkpoint(other)).rejects.toMatchObject({ kind: "usage", message: expect.stringMatching(sentence) });
    expect(git(dir, "for-each-ref", "--format=%(refname)", "refs/tm/").trim()).toBe("refs/tm/cp-0001");
  });

  test("a repository folder an older build stored as something other than one full path is asked again, and only its own project writes it back (Security next-pass LOWs)", async () => {
    const { dir, ctx } = repo("junk");
    await tm.checkpoint(ctx);
    const store = resolveProject(ctx).store;
    const meta = JSON.parse(readFileSync(join(store, "project.json"), "utf8")) as Record<string, unknown>;
    const junk = JSON.stringify({ ...meta, gitCommonDir: "--path-format=absolute\n.git" });
    writeFileSync(join(store, "project.json"), junk);
    const wt = `${dir}-wt`;
    git(dir, "worktree", "add", "-q", wt);
    await expect(tm.checkpoint({ ...ctx, cwd: wt })).rejects.toThrow(/junk-wt shares its Git repository with .*junk, which Time Machine already protects/);
    // Another project's store is never written from here: that write would happen without its lock.
    expect(readFileSync(join(store, "project.json"), "utf8")).toBe(junk);
    writeFileSync(join(dir, "a.txt"), "two\n");
    await tm.checkpoint(ctx);
    expect(JSON.parse(readFileSync(join(store, "project.json"), "utf8")).gitCommonDir).toBe(realpathSync(join(dir, ".git")));
  });

  test("a stored repository folder that is gone, moved behind a gitfile, or no longer the project's, is asked again (Security next-pass LOWs)", async () => {
    const { dir, ctx } = repo("stale");
    await tm.checkpoint(ctx);
    const store = resolveProject(ctx).store;
    const meta = JSON.parse(readFileSync(join(store, "project.json"), "utf8")) as Record<string, unknown>;
    const ref = git(dir, "rev-parse", "refs/tm/cp-0001");
    // --separate-git-dir (like absorbgitdirs) moves .git and leaves a .git file at the stored path, so the path still exists.
    git(dir, "init", "-q", "--separate-git-dir", `${dir}-gitdir`);
    expect(statSync(join(dir, ".git")).isFile()).toBe(true);
    const wt = `${dir}-wt`;
    git(dir, "worktree", "add", "-q", wt);
    writeFileSync(join(wt, "a.txt"), "changed in wt\n");
    await expect(tm.checkpoint({ ...ctx, cwd: wt })).rejects.toThrow(/stale-wt shares its Git repository with .*stale, which Time Machine already protects/);
    expect(git(dir, "rev-parse", "refs/tm/cp-0001")).toBe(ref);
    // A recorded path that no longer exists at all.
    writeFileSync(join(store, "project.json"), JSON.stringify({ ...meta, gitCommonDir: join(dir, "moved-away", ".git") }));
    await expect(tm.checkpoint({ ...ctx, cwd: wt })).rejects.toThrow(/stale-wt shares its Git repository/);
    // The project's own value is asked every time, so one that still exists but is wrong is corrected by its next save.
    writeFileSync(join(store, "project.json"), JSON.stringify({ ...meta, gitCommonDir: homedir() }));
    writeFileSync(join(dir, "a.txt"), "two\n");
    await tm.checkpoint(ctx);
    expect(JSON.parse(readFileSync(join(store, "project.json"), "utf8")).gitCommonDir).toBe(realpathSync(`${dir}-gitdir`));
  });

  test("a save never writes back a project.json that still names another root, as one a relink is moving does (Security next-pass LOW)", async () => {
    const { dir, ctx } = repo("relinking");
    await tm.checkpoint(ctx);
    const store = resolveProject(ctx).store;
    const meta = JSON.parse(readFileSync(join(store, "project.json"), "utf8")) as Record<string, unknown>;
    // The store folder already moved here; relink hasn't written the new root yet.
    const between = JSON.stringify({ ...meta, root: join(dir, "..", "old-path"), gitCommonDir: homedir() });
    writeFileSync(join(store, "project.json"), between);
    writeFileSync(join(dir, "a.txt"), "two\n");
    await tm.checkpoint(ctx);
    expect(readFileSync(join(store, "project.json"), "utf8")).toBe(between);
  });

  test.skipIf(process.getuid?.() === 0)("another store's recorded repository folder that loops or can't be read doesn't stop this project's saves (Security 2c44582 LOW)", async () => {
    const a = repo("looping");
    await tm.checkpoint(a.ctx);
    const astore = resolveProject(a.ctx).store;
    const meta = JSON.parse(readFileSync(join(astore, "project.json"), "utf8")) as Record<string, unknown>;
    const odd = tempDir("odd-paths");
    symlinkSync(join(odd, "loop-b"), join(odd, "loop-a"));
    symlinkSync(join(odd, "loop-a"), join(odd, "loop-b"));
    mkdirSync(join(odd, "locked", "repo", ".git"), { recursive: true });
    chmodSync(join(odd, "locked"), 0o000);
    const b = { cwd: repo("bystander").dir, tmHome: a.home, env: a.ctx.env };
    try {
      for (const [n, recorded] of [[1, join(odd, "loop-a")], [2, join(odd, "locked", "repo", ".git")]] as const) {
        writeFileSync(join(astore, "project.json"), JSON.stringify({ ...meta, gitCommonDir: recorded }));
        writeFileSync(join(b.cwd, "a.txt"), `${n}\n`);
        expect((await tm.checkpoint(b)).checkpoint.id).toBe(`cp-000${n}`);
      }
    } finally {
      chmodSync(join(odd, "locked"), 0o755);
    }
  });

  test("another store's repository folder recorded through a link is compared by where it leads (Security 2c44582 LOW)", async () => {
    const { dir, ctx } = repo("aliased");
    await tm.checkpoint(ctx);
    const store = resolveProject(ctx).store;
    const meta = JSON.parse(readFileSync(join(store, "project.json"), "utf8")) as Record<string, unknown>;
    const alias = join(tempDir("alias"), "git-link");
    symlinkSync(join(dir, ".git"), alias);
    writeFileSync(join(store, "project.json"), JSON.stringify({ ...meta, gitCommonDir: alias }));
    const wt = `${dir}-wt`;
    git(dir, "worktree", "add", "-q", wt);
    await expect(tm.checkpoint({ ...ctx, cwd: wt })).rejects.toThrow(/aliased-wt shares its Git repository with .*aliased, which Time Machine already protects/);
  });

  test("another store's recorded repository folder is trusted only while it is still that project's own .git (Security ef85c18 LOW)", async () => {
    const { dir, ctx } = repo("swapped");
    await tm.checkpoint(ctx);
    const store = resolveProject(ctx).store;
    const meta = JSON.parse(readFileSync(join(store, "project.json"), "utf8")) as Record<string, unknown>;
    const ref = git(dir, "rev-parse", "refs/tm/cp-0001");
    // Some other folder now sits where the recorded .git was, and this project hasn't saved since to correct it.
    writeFileSync(join(store, "project.json"), JSON.stringify({ ...meta, gitCommonDir: tempDir("unrelated") }));
    const wt = `${dir}-wt`;
    git(dir, "worktree", "add", "-q", wt);
    writeFileSync(join(wt, "a.txt"), "changed in wt\n");
    await expect(tm.checkpoint({ ...ctx, cwd: wt })).rejects.toThrow(/swapped-wt shares its Git repository with .*swapped, which Time Machine already protects/);
    expect(git(dir, "rev-parse", "refs/tm/cp-0001")).toBe(ref);
  });

  test("a protected linked worktree whose folder was removed still keeps its repository from a second project (Security b90c40e)", async () => {
    const { dir, ctx } = repo("removed");
    const wt = `${dir}-wt1`;
    git(dir, "worktree", "add", "-q", wt);
    writeFileSync(join(wt, "a.txt"), "wt1\n");
    await tm.checkpoint({ ...ctx, cwd: wt });
    const ref = git(dir, "rev-parse", "refs/tm/cp-0001");
    // git worktree remove deletes the folder; its Git folder, which the store recorded, lives on inside the repository.
    git(dir, "worktree", "remove", "--force", wt);
    writeFileSync(join(dir, "a.txt"), "main change\n");
    await expect(tm.checkpoint(ctx)).rejects.toThrow(/removed shares its Git repository with .*removed-wt1, which Time Machine already protects/);
    expect(git(dir, "rev-parse", "refs/tm/cp-0001")).toBe(ref);
  });

  test("a removed worktree whose path now holds an unrelated folder or file still keeps its repository from a second project (Security 6e1707d LOW)", async () => {
    for (const kind of ["folder", "file"] as const) {
      const { dir, ctx } = repo(`recreated-${kind}`);
      const wt = `${dir}-wt1`;
      git(dir, "worktree", "add", "-q", wt);
      writeFileSync(join(wt, "a.txt"), "wt1\n");
      await tm.checkpoint({ ...ctx, cwd: wt });
      const ref = git(dir, "rev-parse", "refs/tm/cp-0001");
      git(dir, "worktree", "remove", "--force", wt);
      if (kind === "folder") mkdirSync(wt);
      else writeFileSync(wt, "not a project\n");
      writeFileSync(join(dir, "a.txt"), "main change\n");
      await expect(tm.checkpoint(ctx), kind).rejects.toThrow(/shares its Git repository with .*wt1, which Time Machine already protects/);
      expect(git(dir, "rev-parse", "refs/tm/cp-0001"), kind).toBe(ref);
    }
  });

  test("another store's repository that Git answers wrongly about doesn't stop this project's saves (Security INFO)", async () => {
    const broken = repo("broken");
    await tm.checkpoint(broken.ctx);
    const bstore = resolveProject(broken.ctx).store;
    const { gitCommonDir: _drop, ...bmeta } = JSON.parse(readFileSync(join(bstore, "project.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(bstore, "project.json"), JSON.stringify(bmeta));
    const fine = repo("fine");
    const bin = join(tempDir("git-keyed"), "bin");
    mkdirSync(bin);
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    // Only in the broken repo does Git echo the repository question back, as an older Git would.
    writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$(pwd -P)" = "${realpathSync(broken.dir)}" ]; then case "$*" in *--git-common-dir*) echo "--path-format=absolute"; echo ".git"; exit 0;; esac; fi\nexec "${real}" "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    // Both projects in one store, so the fine one's save scans the broken one's.
    const env = { ...process.env, TM_HOME: broken.home, PATH: `${bin}:${process.env.PATH ?? ""}` };
    expect((await tm.checkpoint({ cwd: fine.dir, tmHome: broken.home, env })).checkpoint.id).toBe("cp-0001");
    await expect(tm.checkpoint({ ...broken.ctx, env })).rejects.toThrow(/not one full path/);
  });

  test("a save point whose ref was moved is marked damaged in the timeline and by the integrity check", async () => {
    const { dir, ctx } = repo("moved");
    await tm.checkpoint(ctx);
    writeFileSync(join(dir, "a.txt"), "changed\n");
    await tm.checkpoint(ctx);
    git(dir, "update-ref", "refs/tm/cp-0001", "refs/tm/cp-0002");
    const tl = await tm.timeline(ctx);
    expect(tl.checkpoints[0]?.damaged).toBe("cp-0001 failed its integrity check. Its Git ref was moved.");
    expect(tl.checkpoints[1]?.damaged).toBeUndefined();
    expect(tl.checkpoints[0]?.subject).toBe("first");
    expect(tm.checkIntegrity(ctx).damaged).toEqual([{ id: "cp-0001", reason: "cp-0001 failed its integrity check. Its Git ref was moved." }]);
  });

  test("a Git project that moved: refused with the relink hint, then relinked to the same repository", async () => {
    const { dir, ctx } = repo("shop");
    await tm.checkpoint(ctx);
    const moved = `${dir}-moved`;
    renameSync(dir, moved);
    await expect(tm.timeline(ctx)).rejects.toThrow(/is not there any more\. It is a Git project.*tm relink/);
    const other = repo("elsewhere");
    await expect(tm.relinkProject(ctx, other.dir)).rejects.toThrow("is not the same Git repository");
    await tm.relinkProject(ctx, moved);
    const at = { ...ctx, cwd: moved };
    writeFileSync(join(moved, "a.txt"), "after the move\n");
    expect((await tm.checkpoint(at)).checkpoint.id).toBe("cp-0002");
    expect((await tm.timeline(at)).checkpoints.map((c) => c.damaged)).toEqual([undefined, undefined]);
  });

  test("planInit says what init would set up and writes nothing", async () => {
    const { dir, ctx, home } = repo("plan");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    expect(tm.planInit(ctx)).toMatchObject({ command: "npm test", setup: "", exists: false });
    expect(existsSync(home)).toBe(false);
    const made = await tm.init(ctx, { approve: false });
    expect(tm.planInit(ctx)).toEqual({ command: made.verifyCommand, setup: made.verifySetup, network: made.network, exists: true });
  });
});

describe("every skip is said (cli#1, cli#6, cli#25, writer#5)", () => {
  test.skipIf(process.getuid?.() === 0)("a folder that can't be read is listed in Not saved", async () => {
    const { dir, ctx } = thesis();
    mkdirSync(join(dir, "notes", "secret"));
    writeFileSync(join(dir, "notes", "secret", "t.txt"), "t\n");
    chmodSync(join(dir, "notes", "secret"), 0o000);
    try {
      const r = await tm.checkpoint(ctx);
      expect(r.checkpoint.coverage.missing).toContain("notes/secret: could not be read");
    } finally {
      chmodSync(join(dir, "notes", "secret"), 0o755);
    }
  });

  test.skipIf(process.getuid?.() === 0)("one file that can't be read is left out and named; the rest is saved", async () => {
    const { dir, ctx } = thesis();
    writeFileSync(join(dir, "notes", "locked.md"), "x\n");
    chmodSync(join(dir, "notes", "locked.md"), 0o000);
    try {
      const r = await tm.checkpoint(ctx);
      expect(r.checkpoint.coverage.missing).toContain("notes/locked.md: could not be read");
      const files = readManifest(resolveProject(ctx), r.checkpoint.id).files.map((f) => f.path);
      expect(files).toContain("chapter-1.md");
      expect(files).not.toContain("notes/locked.md");
    } finally {
      chmodSync(join(dir, "notes", "locked.md"), 0o644);
    }
  });

  test("a file over the size cap names the setting and where it lives", async () => {
    const { dir, ctx } = thesis();
    writeFileSync(join(dir, "interview.wav"), Buffer.alloc(6 * 1024 * 1024));
    const r = await tm.checkpoint(ctx);
    const settings = tm.projectConfig(ctx).configPath;
    expect(r.checkpoint.coverage.missing).toContain(`interview.wav: over the 5 MB limit (capture.maxFileMB in ${settings})`);
    expect((await tm.timeline(ctx)).checkpoints[0]?.coverage.missing).toContain(`interview.wav: over the 5 MB limit (capture.maxFileMB in ${settings})`);
  });

  test("a saved copy gone from the store: open and recover say so, the timeline and the integrity check flag it", async () => {
    const { root, dir, ctx } = thesis();
    await tm.checkpoint(ctx);
    expect(tm.checkIntegrity(ctx)).toMatchObject({ damaged: [], missingBlobs: [] });
    const p = resolveProject(ctx);
    const f = readManifest(p, "cp-0001").files.find((x) => x.path === "chapter-1.md");
    rmSync(blobPath(p, f?.sha256 ?? ""));
    const opened = await tm.open(ctx, "cp-0001", { dir: join(root, "copy") });
    expect(opened.missing).toEqual(["the saved copy of chapter-1.md is gone from the store"]);
    // Changed first, so the save the recovery makes before it does not put the same bytes back.
    writeFileSync(join(dir, "chapter-1.md"), "# One, rewritten\n");
    const r = await tm.recover(ctx, "cp-0001");
    expect(r.missing).toEqual(["the saved copy of chapter-1.md is gone from the store"]);
    expect(r.manualSteps).toContain("Recreate chapter-1.md by hand.");
    expect((await tm.timeline(ctx)).checkpoints[0]?.damaged).toBe("The saved copy of chapter-1.md is gone from the store.");
    const report = tm.checkIntegrity(ctx);
    expect(report.missingBlobs).toEqual([{ id: "cp-0001", path: "chapter-1.md", reason: "the saved copy of chapter-1.md is gone from the store" }]);
    expect(tm.checkStore(ctx).map((x) => x.missingBlobs.length)).toEqual([1]);
    expect(existsSync(dir)).toBe(true);
  });

  test("a missing ID is a usage error; a thinned one says when, and the nearest kept", async () => {
    const { ctx } = thesis();
    await tm.checkpoint(ctx);
    await expect(tm.open(ctx, "cp-0009")).rejects.toMatchObject({ kind: "usage", message: "There is no checkpoint cp-0009. Run tm timeline to see them." });
    const p = resolveProject(ctx);
    appendFileSync(join(p.store, "audit.jsonl"), `${JSON.stringify({ at: "2026-10-26T12:00:00.000Z", action: "thin", target: null, result: "removed 2 old auto saves: cp-0002, cp-0004" })}\n`);
    await expect(tm.open(ctx, "cp-0004")).rejects.toMatchObject({ kind: "usage", message: "cp-0004 was removed by thinning on 26 Oct 2026; nearest kept: cp-0001." });
  });
});

describe("copies (writer#27,#28)", () => {
  test("a copy gives each saved file the modified time it was saved with; older save points still read", async () => {
    const { root, ctx } = thesis();
    await tm.checkpoint(ctx);
    const p = resolveProject(ctx);
    const { integrity: _old, ...body } = readManifest(p, "cp-0001");
    const when = Date.parse("2026-10-20T09:30:00Z");
    const path = join(p.store, "checkpoints", "cp-0001.json");
    chmodSync(path, 0o600);
    rmSync(path);
    writeManifest(p, { ...body, files: body.files.map((f) => ({ ...f, mtimeMs: when })) });
    const opened = await tm.open(ctx, "cp-0001", { dir: join(root, "copy") });
    expect(statSync(join(opened.dir, "chapter-1.md")).mtimeMs).toBe(when);
    expect(statSync(join(opened.dir, "notes", "reading.md")).mtimeMs).toBe(when);
  });

  test("a save point whose file mode has set-id bits, or whose modified time is out of range, is refused, never copied (Security F5)", async () => {
    const { root, ctx } = thesis();
    await tm.checkpoint(ctx);
    const p = resolveProject(ctx);
    const { integrity: _old, ...body } = readManifest(p, "cp-0001");
    const path = join(p.store, "checkpoints", "cp-0001.json");
    for (const [n, patch] of [{ mode: 0o4755 }, { mtimeMs: 1e300 }].entries()) {
      chmodSync(path, 0o600);
      rmSync(path);
      writeManifest(p, { ...body, files: body.files.map((f) => ({ ...f, ...patch })) });
      await expect(tm.open(ctx, "cp-0001", { dir: join(root, `copy-${n}`) })).rejects.toMatchObject({ kind: "integrity" });
    }
  });

  test("system and editor files are one list, shared with auto save", () => {
    expect(tm.JUNK_FILE_NAMES).toEqual(expect.arrayContaining([".DS_Store", "Thumbs.db"]));
    for (const f of [".DS_Store", "notes/.DS_Store", "Thumbs.db", "~$draft.docx", ".#chapter.md", "chapter.md.swp"]) expect(tm.isJunkFile(f)).toBe(true);
    for (const f of ["chapter-1.md", "DS_Store.md", "notes/Thumbs.db.txt"]) expect(tm.isJunkFile(f)).toBe(false);
  });

  test("a save records each file's modified time, and never a .DS_Store", async () => {
    const { root, dir, ctx } = thesis();
    writeFileSync(join(dir, ".DS_Store"), "junk");
    writeFileSync(join(dir, "notes", ".DS_Store"), "junk");
    const when = new Date("2026-10-20T09:30:00Z");
    utimesSync(join(dir, "chapter-1.md"), when, when);
    const r = await tm.checkpoint(ctx);
    const m = readManifest(resolveProject(ctx), r.checkpoint.id);
    expect(m.files.map((f) => f.path)).not.toContain(".DS_Store");
    expect(m.files.map((f) => f.path)).not.toContain("notes/.DS_Store");
    expect(m.files.find((f) => f.path === "chapter-1.md")?.mtimeMs).toBe(when.getTime());
    const opened = await tm.open(ctx, r.checkpoint.id, { dir: join(root, "copy2") });
    expect(statSync(join(opened.dir, "chapter-1.md")).mtimeMs).toBe(when.getTime());
    expect(existsSync(join(opened.dir, ".DS_Store"))).toBe(false);
  });

  test("an editor's lock or swap file left out of a save is named, since such a name can be someone's real file; it doesn't make the save point incomplete; folder settings files stay silent (Security F8)", async () => {
    const { dir, ctx } = thesis();
    await tm.setCheck(ctx, "test -f chapter-1.md");
    for (const f of [".DS_Store", "notes/Thumbs.db", "~$draft.docx", "notes/.#chapter.md", "chapter.md.swp"]) writeFileSync(join(dir, f), "x");
    mkdirSync(join(dir, "backup.swp"));
    writeFileSync(join(dir, "backup.swp", "kept.md"), "x");
    const r = await tm.checkpoint(ctx);
    expect(r.checkpoint.coverage.missing.filter((s) => /swap|Thumbs|DS_Store|~\$|\.#/.test(s))).toEqual([]);
    expect(r.checkpoint.coverage.manual.filter((s) => s.includes("lock or swap")).sort()).toEqual([
      "chapter.md.swp looks like an editor's lock or swap file, so it was not saved",
      "notes/.#chapter.md looks like an editor's lock or swap file, so it was not saved",
      "~$draft.docx looks like an editor's lock or swap file, so it was not saved",
    ]);
    expect((await tm.verify(ctx, r.checkpoint.id)).verdict).toBe("PASS");
  });

  test("a nested repository named like a swap file is named as a nested repository, not as a lock file (Security F8 follow-up)", async () => {
    const { dir, ctx } = thesis();
    mkdirSync(join(dir, "backup.swp"));
    git(join(dir, "backup.swp"), "init", "-q");
    writeFileSync(join(dir, "backup.swp", "kept.md"), "x");
    const r = await tm.checkpoint(ctx);
    expect(r.checkpoint.coverage.missing).toContain("backup.swp is a nested Git repository or folder Git skips, so it was not saved");
    expect(r.checkpoint.coverage.manual.filter((s) => s.includes("backup.swp"))).toEqual([]);
  });
});

describe("config files a save can't check (Security N1, T7, T8)", () => {
  test.skipIf(process.platform === "win32")("each is named with its reason, a folder that is a link doesn't stop the save, and a config file in a folder that isn't there stays unsaid", async () => {
    const root = tempDir("config-n1");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(root, "outside"), { recursive: true });
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    const files = ["linked/app.env", "locked/app.env", "folder.env", "big.env", "link.env", "shut.env", "gone/app.env"];
    writeFileSync(join(dir, "timemachine.yml"), `capture:\n  maxFileMB: 0.001\nconfig:\n  files: [${files.join(", ")}]\n`);
    writeFileSync(join(dir, ".gitignore"), "linked\nlocked\nfolder.env\nbig.env\nlink.env\nshut.env\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    writeFileSync(join(root, "outside", "app.env"), "MODE=outside\n");
    symlinkSync(join(root, "outside"), join(dir, "linked"));
    mkdirSync(join(dir, "locked"));
    writeFileSync(join(dir, "locked", "app.env"), "MODE=locked\n");
    mkdirSync(join(dir, "folder.env"));
    writeFileSync(join(dir, "big.env"), `MODE=${"x".repeat(2000)}\n`);
    symlinkSync(join(root, "outside", "app.env"), join(dir, "link.env"));
    writeFileSync(join(dir, "shut.env"), "MODE=shut\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    chmodSync(join(dir, "locked"), 0o000);
    chmodSync(join(dir, "shut.env"), 0o000);
    try {
      const r = await tm.checkpoint(ctx);
      const lines = r.checkpoint.coverage.missing.filter((s) => s.includes("keys were not recorded"));
      expect(lines.sort()).toEqual([
        "big.env is over the 0.001 MB limit, so its keys were not recorded",
        "folder.env is not a regular file, so its keys were not recorded",
        "link.env is not a regular file, so its keys were not recorded",
        "linked/app.env: a folder on the way is a symbolic link or can't be read, so its keys were not recorded",
        "locked/app.env: a folder on the way is a symbolic link or can't be read, so its keys were not recorded",
        "shut.env could not be read, so its keys were not recorded",
      ]);
      expect(readManifest(resolveProject(ctx), r.checkpoint.id).config).toEqual([]);
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
      chmodSync(join(dir, "shut.env"), 0o644);
    }
  });

  test.skipIf(process.platform === "win32")("a tracked config file keeps its committed version in the save point, whatever the folder holds at the time of the save (Security R7-1)", async () => {
    const root = tempDir("config-r71");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(dir, "settings"), { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [settings/app.env]\n");
    writeFileSync(join(dir, "settings", "app.env"), "MODE=committed\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const committed = git(dir, "rev-parse", "HEAD:settings/app.env");
    // The folder becomes a link to a copy with other contents: the exclude can't be used, and git add would stage the change.
    renameSync(join(dir, "settings"), join(root, "settings-real"));
    writeFileSync(join(root, "settings-real", "app.env"), "MODE=changed\n");
    symlinkSync(join(root, "settings-real"), join(dir, "settings"));
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const snapshot = readManifest(resolveProject(ctx), r.checkpoint.id).git.snapshot;
    expect(git(dir, "rev-parse", `${snapshot}:settings/app.env`)).toBe(committed);
  });

  test("a save works whatever pathspec settings the user's environment has (Security L1)", async () => {
    const root = tempDir("config-l1");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(dir, "settings"), { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [settings/app.env]\n");
    writeFileSync(join(dir, "settings", "app.env"), "MODE=one\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    for (const name of ["GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS", "GIT_LITERAL_PATHSPECS"]) {
      const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home, [name]: "1" } };
      writeFileSync(join(dir, "notes.md"), `${name}\n`);
      const r = await tm.checkpoint(ctx);
      expect(r.checkpoint.coverage.missing.filter((s) => s.includes("keys")), name).toEqual([]);
    }
  });

  test.skipIf(process.platform === "win32")("a config path that is a folder keeps the committed version of everything under it, even when the folder is now a link (Security L2)", async () => {
    const root = tempDir("config-l2");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(dir, "conf"), { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [conf]\n");
    writeFileSync(join(dir, "conf", "a.txt"), "MODE=committed\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const committed = git(dir, "rev-parse", "HEAD:conf/a.txt");
    renameSync(join(dir, "conf"), join(root, "conf-real"));
    writeFileSync(join(root, "conf-real", "a.txt"), "MODE=changed\n");
    symlinkSync(join(root, "conf-real"), join(dir, "conf"));
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const snapshot = readManifest(resolveProject(ctx), r.checkpoint.id).git.snapshot;
    expect(git(dir, "rev-parse", `${snapshot}:conf/a.txt`)).toBe(committed);
  });

  test("on a disk that ignores letter case, a config path matches its tracked file in any case (Security L3)", async (t) => {
    const root = tempDir("config-l3");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(dir, "Settings"), { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    // Git writes core.ignorecase only on a disk that ignores case; elsewhere (Linux) the key is unset.
    if (git(dir, "config", "--bool", "--default", "false", "core.ignorecase") !== "true") t.skip();
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [settings/app.env]\n");
    writeFileSync(join(dir, "Settings", "App.env"), "MODE=committed\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const committed = git(dir, "rev-parse", "HEAD:Settings/App.env");
    writeFileSync(join(dir, "Settings", "App.env"), "MODE=changed\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const snapshot = readManifest(resolveProject(ctx), r.checkpoint.id).git.snapshot;
    expect(git(dir, "rev-parse", `${snapshot}:Settings/App.env`)).toBe(committed);
  });

  test("new files under a config folder, or a config file in another letter case, are never copied as plain files (Security next-pass LOW)", async () => {
    const root = tempDir("config-untracked");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(dir, "conf"), { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    const icase = git(dir, "config", "--bool", "--default", "false", "core.ignorecase") === "true";
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [conf, settings.env]\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    writeFileSync(join(dir, "conf", "new.txt"), "MODE=new\n");
    writeFileSync(join(dir, "Settings.env"), "MODE=case\n");
    writeFileSync(join(dir, "notes.md"), "kept\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const copied = readManifest(resolveProject(ctx), r.checkpoint.id).files.map((f) => f.path).sort();
    expect(copied).toEqual(icase ? ["notes.md"] : ["Settings.env", "notes.md"]);
  });

  test("a config file inside a submodule doesn't stop the save (Security next-pass LOW)", async () => {
    const root = tempDir("config-submodule");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(dir, "sub"), { recursive: true });
    git(join(dir, "sub"), "init", "-q", "-b", "main");
    writeFileSync(join(dir, "sub", "app.env"), "MODE=sub\n");
    git(join(dir, "sub"), "add", ".");
    git(join(dir, "sub"), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "sub");
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [sub/app.env]\n");
    writeFileSync(join(dir, "readme.md"), "one\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    writeFileSync(join(dir, "readme.md"), "two\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const snapshot = readManifest(resolveProject(ctx), r.checkpoint.id).git.snapshot;
    expect(git(dir, "show", `${snapshot}:readme.md`)).toBe("two");
    expect(readManifest(resolveProject(ctx), r.checkpoint.id).config.map((c) => c.file)).toEqual(["sub/app.env"]);
  });

  test("a config name written in another Unicode form still covers its file (Security optional LOW, NFC)", async () => {
    const root = tempDir("config-nfc");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    const composed = "caf\u00e9.env";
    writeFileSync(join(dir, "timemachine.yml"), `config:\n  files: [${composed.normalize("NFD")}]\n`);
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    writeFileSync(join(dir, composed), "MODE=plain\n");
    writeFileSync(join(dir, "notes.md"), "kept\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    expect(readManifest(resolveProject(ctx), r.checkpoint.id).files.map((f) => f.path)).toEqual(["notes.md"]);
  });

  test("on a disk that ignores case, config paths match in any case even when Git isn't told so, and in any script (Security optional LOWs)", async (t) => {
    const root = tempDir("config-diskcase");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe"), "");
    if (!existsSync(join(dir, "PROBE"))) t.skip();
    rmSync(join(dir, "probe"));
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "core.ignorecase", "false");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [settings.env, r\u00e9glages.env, other.env]\n");
    writeFileSync(join(dir, "Settings.env"), "MODE=committed\n");
    writeFileSync(join(dir, "R\u00c9GLAGES.env"), "MODE=committed\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const committed = git(dir, "rev-parse", "HEAD:Settings.env");
    writeFileSync(join(dir, "Settings.env"), "MODE=changed\n");
    writeFileSync(join(dir, "R\u00c9GLAGES.env"), "MODE=changed\n");
    writeFileSync(join(dir, "Other.env"), "MODE=plain\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const m = readManifest(resolveProject(ctx), r.checkpoint.id);
    expect(git(dir, "rev-parse", `${m.git.snapshot}:Settings.env`)).toBe(committed);
    expect(git(dir, "rev-parse", `${m.git.snapshot}:R\u00c9GLAGES.env`)).toBe(committed);
    expect(m.files.map((f) => f.path)).toEqual([]);
  });

  test("a tracked config name that isn't valid UTF-8 keeps HEAD's entry in the save point (Security L1)", async () => {
    const root = tempDir("config-bytes");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [secrets]\n");
    writeFileSync(join(dir, "readme.md"), "one\n");
    git(dir, "add", ".");
    // An index entry made by hand: a disk that only holds UTF-8 names can't have the file, but Git keeps the bytes as they are.
    const sha = rawGit(dir, ["hash-object", "-w", "--stdin"], Buffer.from("MODE=committed\n")).toString().trim();
    rawGit(dir, ["update-index", "--add", "--index-info"], Buffer.concat([Buffer.from(`100644 ${sha} 0\t`), FF_NAME, Buffer.from("\n")]));
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    writeFileSync(join(dir, "readme.md"), "two\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const snapshot = readManifest(resolveProject(ctx), r.checkpoint.id).git.snapshot;
    const listed = rawGit(dir, ["ls-tree", "-r", "-z", snapshot]);
    expect(listed.includes(Buffer.concat([Buffer.from(`blob ${sha}\t`), FF_NAME, Buffer.from([0])]))).toBe(true);
    expect(git(dir, "show", `${snapshot}:readme.md`)).toBe("two");
  });

  test.skipIf(process.platform !== "linux")("an edited config file whose name isn't valid UTF-8 keeps its committed text (Security L1, Linux disks)", async () => {
    const root = tempDir("config-bytes-disk");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(join(dir, "secrets"), { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [secrets]\n");
    const file = Buffer.concat([Buffer.from(`${dir}/`), FF_NAME]);
    writeFileSync(file, "MODE=committed\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const committed = rawGit(dir, ["hash-object", "--stdin"], Buffer.from("MODE=committed\n")).toString().trim();
    writeFileSync(file, "MODE=changed\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const snapshot = readManifest(resolveProject(ctx), r.checkpoint.id).git.snapshot;
    expect(rawGit(dir, ["ls-tree", "-r", "-z", snapshot]).includes(Buffer.concat([Buffer.from(`blob ${committed}\t`), FF_NAME, Buffer.from([0])]))).toBe(true);
  });

  test("files named like a commit or tree don't stop saves, the compare or the timeline (Security I2, F1)", async () => {
    const root = tempDir("config-revname");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), "config:\n  files: [app.env]\n");
    writeFileSync(join(dir, "app.env"), "MODE=committed\n");
    writeFileSync(join(dir, "readme.md"), "one\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    // A save of a clean folder is HEAD itself, so the next save's bundle and tree compare name HEAD and its tree.
    expect((await tm.checkpoint(ctx)).checkpoint.id).toBe("cp-0001");
    writeFileSync(join(dir, git(dir, "rev-parse", "HEAD")), "a note\n");
    writeFileSync(join(dir, git(dir, "rev-parse", "HEAD^{tree}")), "another note\n");
    writeFileSync(join(dir, "readme.md"), "two\n");
    expect((await tm.checkpoint(ctx)).checkpoint.id).toBe("cp-0002");
    expect((await tm.diff(ctx, "cp-0001", "cp-0002")).code).toContainEqual({ status: "M", path: "readme.md" });
    expect((await tm.timeline(ctx)).checkpoints.map((c) => c.subject)).toEqual(["first", "first"]);
  });

  test("a config name with pattern characters resets only itself (Security N5)", async () => {
    const root = tempDir("config-glob");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), 'config:\n  files: ["[a]b.txt"]\n');
    writeFileSync(join(dir, "[a]b.txt"), "committed\n");
    writeFileSync(join(dir, "ab.txt"), "committed\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    writeFileSync(join(dir, "[a]b.txt"), "changed\n");
    writeFileSync(join(dir, "ab.txt"), "an edit to keep\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    const r = await tm.checkpoint(ctx);
    const snapshot = readManifest(resolveProject(ctx), r.checkpoint.id).git.snapshot;
    expect(git(dir, "show", `${snapshot}:[a]b.txt`)).toBe("committed");
    expect(git(dir, "show", `${snapshot}:ab.txt`)).toBe("an edit to keep");
  });

  test("on a disk that ignores case, a folder project whose name has no letters still matches config paths in any case (Security L2)", async (t) => {
    const root = tempDir("config-uncased");
    const dir = join(root, "2026");
    const home = join(root, "store");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe"), "");
    if (!existsSync(join(dir, "PROBE"))) t.skip();
    rmSync(join(dir, "probe"));
    writeFileSync(join(dir, "notes.md"), "one\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    tm.protect(ctx);
    const p = resolveProject(ctx);
    writeFileSync(join(p.store, "timemachine.yml"), "config:\n  files: [settings.env]\n");
    rawGit(dir, ["--git-dir", p.env[SHADOW_GIT_DIR] ?? "", "config", "core.ignorecase", "false"]);
    writeFileSync(join(dir, "Settings.env"), "MODE=plain\n");
    const r = await tm.checkpoint(ctx);
    expect(readManifest(p, r.checkpoint.id).files.map((f) => f.path)).not.toContain("Settings.env");
  });

  test("on a disk that ignores case, a name whose only letters aren't A to Z doesn't decide the disk's case (Security F2)", async (t) => {
    const root = tempDir("config-dotless");
    const dir = join(root, "2026");
    const home = join(root, "store");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe"), "");
    if (!existsSync(join(dir, "PROBE"))) t.skip();
    rmSync(join(dir, "probe"));
    // "0ı" lists first, and JavaScript flips its dotless i to I, a different name on the disk, too.
    writeFileSync(join(dir, "0\u0131"), "one\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    tm.protect(ctx);
    const p = resolveProject(ctx);
    writeFileSync(join(p.store, "timemachine.yml"), "config:\n  files: [settings.env]\n");
    rawGit(dir, ["--git-dir", p.env[SHADOW_GIT_DIR] ?? "", "config", "core.ignorecase", "false"]);
    writeFileSync(join(dir, "Settings.env"), "MODE=plain\n");
    const r = await tm.checkpoint(ctx);
    expect(readManifest(p, r.checkpoint.id).files.map((f) => f.path)).toEqual(["0\u0131"]);
  });
});

describe("Git version (Security I1)", () => {
  test("every command asks for Git 2.36 or later, and says so when Git is missing or can't say its version (Security I1, L2)", async () => {
    const root = tempDir("git-version");
    const dir = join(root, "app");
    const home = join(root, "store");
    mkdirSync(dir, { recursive: true });
    const fakeGit = (name: string, script: string): tm.Ctx => {
      const bin = join(root, name);
      mkdirSync(bin);
      writeFileSync(join(bin, "git"), `#!/bin/sh\n${script}\n`);
      chmodSync(join(bin, "git"), 0o755);
      return { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home, PATH: bin } };
    };
    const old = fakeGit("old", 'echo "git version 2.35.9"');
    await expect(tm.init(old)).rejects.toThrow("Time Machine needs Git 2.36 or later. This computer has Git 2.35.9.");
    await expect(tm.recover(old, "cp-0001")).rejects.toThrow("Time Machine needs Git 2.36 or later. This computer has Git 2.35.9.");
    // A Git project can save without tm init, so the check sits where every command starts.
    await expect(tm.checkpoint(old)).rejects.toThrow("Time Machine needs Git 2.36 or later. This computer has Git 2.35.9.");
    await expect(tm.timeline(old)).rejects.toThrow("Time Machine needs Git 2.36 or later. This computer has Git 2.35.9.");
    await expect(tm.relinkProject(old, root)).rejects.toThrow("Time Machine needs Git 2.36 or later. This computer has Git 2.35.9.");
    expect(() => tm.checkStore(old)).toThrow("Time Machine needs Git 2.36 or later. This computer has Git 2.35.9.");
    expect(() => tm.storeProjects(old)).toThrow("Time Machine needs Git 2.36 or later. This computer has Git 2.35.9.");
    // Terminal codes, C1 controls and direction marks never reach the message.
    const stub = fakeGit("stub", 'printf "xcrun: error: invalid \\033[31mactive\\033[0m \\302\\233developer\\342\\200\\256 path\\n" >&2\nexit 1');
    await expect(tm.init(stub)).rejects.toThrow("Time Machine needs Git 2.36 or later, and git --version failed: xcrun: error: invalid [31mactive[0m developer path");
    const long = fakeGit("long", `printf "${"x".repeat(300)}\\n" >&2\nexit 1`);
    await expect(tm.init(long)).rejects.toThrow(`git --version failed: ${"x".repeat(197)}...`);
    const none: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home, PATH: join(root, "empty"), TMPDIR: join(root, "no-such-folder") } };
    await expect(tm.init(none)).rejects.toThrow("Time Machine needs Git 2.36 or later, and Git isn't installed.");
    // A PATH no earlier check passed, so this one really runs: a missing TMPDIR must not read as a missing Git.
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const wrapped = fakeGit("wrapped", `exec "${real}" "$@"`);
    const found: tm.Ctx = { ...none, env: { ...none.env, PATH: `${wrapped.env?.PATH ?? ""}:${process.env.PATH ?? ""}` } };
    expect((await tm.init(found)).created).toBe(true);
  });

  test("on an older Git, the Claude Code plugin says why it stopped saving, once (Security INFO)", async () => {
    const root = tempDir("git-notice");
    const dir = join(root, "app");
    const home = join(root, "store");
    const bin = join(root, "bin");
    mkdirSync(dir, { recursive: true });
    mkdirSync(bin);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "timemachine.yml"), 'verify:\n  command: "true"\n');
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    await tm.init({ cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } });
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$*" in *--version*) echo "git version 2.35.9"; exit 0;; esac\nexec "${real}" "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` } };
    // Pre-bash and stop stay silent: only a prompt shows the user a message, and they don't use up the one notice.
    for (const event of ["pre-bash", "stop"] as const) {
      const r = await tm.runHook(ctx, event, { cwd: dir, tool_input: { command: "rm -rf build" } }, { requireConfig: true });
      expect(r).toMatchObject({ checkpoint: null, message: "" });
      expect(r.systemMessage).toBeUndefined();
    }
    const first = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, { requireConfig: true });
    expect(first).toMatchObject({ checkpoint: null, systemMessage: "Time Machine needs Git 2.36 or later. This computer has Git 2.35.9." });
    const second = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "y" }, { requireConfig: true });
    expect(second.systemMessage).toBeUndefined();
    expect(second.checkpoint).toBeNull();
    // A repo this computer never set up stays silent and gets no store.
    const other = join(root, "other");
    mkdirSync(other);
    git(other, "init", "-q", "-b", "main");
    writeFileSync(join(other, "timemachine.yml"), 'verify:\n  command: "true"\n');
    const fresh = join(root, "fresh-store");
    const quiet = await tm.runHook({ cwd: other, tmHome: fresh, env: { ...ctx.env, TM_HOME: fresh } }, "prompt", { cwd: other, prompt: "x" }, { requireConfig: true });
    expect(quiet.systemMessage).toBeUndefined();
    expect(existsSync(fresh)).toBe(false);
  });

  test("relink checks the Git version before it touches a moved project's store (Security S6)", async () => {
    const root = tempDir("git-relink");
    const dir = join(root, "app");
    const home = join(root, "store");
    const bin = join(root, "bin");
    mkdirSync(dir, { recursive: true });
    mkdirSync(bin);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "one\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home } };
    await tm.checkpoint(ctx);
    const moved = join(root, "moved");
    renameSync(dir, moved);
    // Every Git command works except that it says it is 2.35.9, so only the version check can stop the move.
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$*" in *--version*) echo "git version 2.35.9"; exit 0;; esac\nexec "${real}" "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const before = readdirSync(join(home, "projects"));
    // The old path is gone, so relink finds the project in the store, not through resolveProject.
    await expect(tm.relinkProject({ ...ctx, env: { ...ctx.env, PATH: `${bin}:${process.env.PATH ?? ""}` } }, moved)).rejects.toThrow("Time Machine needs Git 2.36 or later. This computer has Git 2.35.9.");
    expect(readdirSync(join(home, "projects"))).toEqual(before);
  });

  test("a Git that answers the repository question with something other than one full path stops the save (Security L2)", async () => {
    const root = tempDir("git-commondir");
    const dir = join(root, "app");
    const home = join(root, "store");
    const bin = join(root, "bin");
    mkdirSync(dir, { recursive: true });
    mkdirSync(bin);
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "readme.md"), "one\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    // Git before 2.31 doesn't know --path-format and may print it back with exit code 0.
    writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$*" in *--path-format*) echo "--path-format=absolute"; echo ".git"; exit 0;; esac\nexec "${real}" "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const ctx: tm.Ctx = { cwd: dir, tmHome: home, env: { ...process.env, TM_HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` } };
    await expect(tm.checkpoint(ctx)).rejects.toMatchObject({ kind: "usage", message: 'Git named the repository\'s folder as "--path-format=absolute .git", not one full path. Time Machine needs Git 2.36 or later.' });
  });
});

describe("check settings (dev#11)", () => {
  test("a folder's settings read with defaults and change in the store file, approving a changed check", () => {
    const { ctx } = thesis();
    expect(tm.projectConfig(ctx)).toMatchObject({ command: "", setup: "", timeoutSeconds: 600, network: "allow", maxFileMB: 5 });
    const s = tm.setProjectConfig(ctx, { maxFileMB: 50, command: "node check.js", timeoutSeconds: 30 });
    expect(s).toMatchObject({ command: "node check.js", maxFileMB: 50, timeoutSeconds: 30 });
    expect(tm.approvedCheck(ctx)).toEqual({ state: "approved", command: "node check.js" });
    expect(() => tm.setProjectConfig(ctx, { maxFileMB: 0 })).toThrow("more than 0 MB");
    expect(() => tm.setProjectConfig(ctx, { command: "a\nb" })).toThrow("one line");
    expect(readdirSync(ctx.cwd)).toEqual(["chapter-1.md", "notes"]);
  });

  test("a compare-and-set change on a folder with no settings file yet fails and makes none", () => {
    const { ctx } = thesis();
    const { configPath } = tm.projectConfig(ctx);
    rmSync(configPath, { force: true });
    expect(() => tm.setProjectConfig(ctx, { command: "node check.js" }, { ifCommand: "" })).toThrow("This folder has no check settings saved yet");
    expect(existsSync(configPath)).toBe(false);
  });
});

const sandboxed = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");

describe("a check may not write outside its copy (dev#3)", () => {
  test.skipIf(!sandboxed)("with sandbox-exec, a write into the real folder fails and the result says confined", async () => {
    // The temp folders stay writable for checks, so the project lives outside them, as a real one does.
    const outside = mkdtempSync(join(homedir(), ".tm-sandbox-test-"));
    try {
      const dir = join(outside, "shop");
      mkdirSync(dir);
      writeFileSync(join(dir, "index.md"), "shop\n");
      const ctx: tm.Ctx = { cwd: dir, tmHome: join(tempDir("sandbox"), "store"), env: { ...process.env } };
      ctx.env = { ...ctx.env, TM_HOME: ctx.tmHome };
      tm.protect(ctx);
      const target = join(dir, "WRITTEN_BY_CHECK.txt");
      tm.setProjectConfig(ctx, { command: `node -e 'require("fs").writeFileSync(${JSON.stringify(target)}, "x")'`, network: "deny" });
      await tm.checkpoint(ctx);
      const r = await tm.verify(ctx);
      expect(r.verdict).toBe("FAIL");
      expect(r.isolation).toBe("confined");
      expect(existsSync(target)).toBe(false);
      tm.setProjectConfig(ctx, { command: `node -e 'require("fs").writeFileSync("inside.txt", "x")'` });
      expect((await tm.verify(ctx)).verdict).toBe("PASS");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
