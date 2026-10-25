// Plain folders against files someone else put in them (a shared or synced folder, an unpacked archive,
// an agent's workspace): a planted .git or timemachine.yml never runs anything or changes what is saved,
// the store is private to this user, and recovery copes with links at the copy name.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { tempDir } from "../../../fixtures/demo/setup.ts";

/** A protected plain folder with one save point. `marker` is where a planted command would write. */
async function savedFolder(name: string, folderName = "workspace"): Promise<{ root: string; dir: string; store: string; ctx: tm.Ctx; marker: string }> {
  const root = tempDir(name);
  const dir = join(root, folderName);
  const store = join(root, "store");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "notes.md"), "hello\n");
  const ctx: tm.Ctx = { cwd: dir, tmHome: store, env: { ...process.env, TM_HOME: store } };
  tm.protect(ctx);
  await tm.checkpoint(ctx, { note: "Auto save", trigger: "auto" });
  return { root, dir, store, ctx, marker: join(root, "MARKER") };
}

/** The planter's git: run with no Time Machine settings, as anyone could, only to write the bytes of a .git. */
function plantGit(repo: string, config: [string, string][]): void {
  execFileSync("git", ["init", "-q", repo]);
  for (const [k, v] of config) execFileSync("git", ["-C", repo, "config", k, v]);
}

/** What the next auto save does now: the project it resolves to, its history, and whether the save worked. */
async function afterPlant(dir: string, ctx: tm.Ctx): Promise<{ kind: string; root: string; ids: string[]; save: string }> {
  const p = tm.protect(ctx, { dryRun: true });
  const ids = await tm.timeline(ctx).then((t) => t.checkpoints.map((c) => c.id), () => []);
  writeFileSync(join(dir, "notes.md"), "changed\n");
  const save = await tm.checkpoint(ctx, { note: "Auto save", trigger: "auto" }).then((r) => r.checkpoint.id, (e: Error) => `threw: ${e.message}`);
  return { kind: p.kind, root: p.root, ids, save };
}

/** Every file in the store, unpacked, so a test can look for a value in all of them. */
function storeText(store: string): string {
  const parts: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".gz")) parts.push(gunzipSync(readFileSync(full)).toString("latin1"));
      else parts.push(readFileSync(full).toString("latin1"));
    }
  };
  walk(store);
  return parts.join("\n");
}

describe("a .git planted in a protected folder never runs anything (F1)", () => {
  test("core.worktree pointing at a subfolder plus core.fsmonitor: still the folder project, history kept, the save works, nothing ran", async () => {
    const { dir, ctx, marker } = await savedFolder("plant-worktree");
    const real = tm.protect(ctx, { dryRun: true }).root;
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "x.md"), "x\n");
    plantGit(dir, [["core.worktree", join(dir, "sub")]]);
    execFileSync("git", ["-C", dir, "add", "x.md"], { cwd: join(dir, "sub") });
    execFileSync("git", ["-C", dir, "-c", "user.name=a", "-c", "user.email=a@b", "commit", "-q", "-m", "x"], { cwd: join(dir, "sub") });
    execFileSync("git", ["-C", dir, "config", "core.fsmonitor", `echo ran >> '${marker}'; false`]);

    const r = await afterPlant(dir, ctx);
    expect(r).toEqual({ kind: "folder", root: real, ids: ["cp-0001"], save: "cp-0002" });
    expect((await tm.timeline(ctx)).checkpoints.map((c) => c.id)).toEqual(["cp-0001", "cp-0002"]);
    expect(existsSync(marker)).toBe(false);
  });

  test("a .git with no core.worktree, at the top or in a subfolder, is ignored: the folder project stays, from the subfolder too", async () => {
    const { dir, ctx, marker } = await savedFolder("plant-plain");
    const real = tm.protect(ctx, { dryRun: true }).root;
    const fsmonitor: [string, string] = ["core.fsmonitor", `echo ran >> '${marker}'; false`];
    plantGit(dir, [fsmonitor]);
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "x.md"), "x\n");
    plantGit(join(dir, "sub"), [fsmonitor]);

    expect(await afterPlant(dir, ctx)).toEqual({ kind: "folder", root: real, ids: ["cp-0001"], save: "cp-0002" });
    const sub: tm.Ctx = { ...ctx, cwd: join(dir, "sub") };
    expect(tm.protect(sub, { dryRun: true })).toEqual({ kind: "folder", root: real });
    expect((await tm.timeline(sub)).checkpoints.map((c) => c.id)).toEqual(["cp-0001", "cp-0002"]);
    expect((await tm.checkpoint(sub, { note: "Auto save", trigger: "auto" })).checkpoint.id).toBe("cp-0003");
    expect(existsSync(marker)).toBe(false);
  });

  test("core.hooksPath pointing at planted hook scripts, with core.worktree: still the folder project, and no hook ran", async () => {
    const { dir, ctx, marker } = await savedFolder("plant-hooks");
    const real = tm.protect(ctx, { dryRun: true }).root;
    const hooks = join(dir, "hooks");
    mkdirSync(hooks);
    for (const name of ["reference-transaction", "pre-commit", "post-commit", "post-checkout", "post-index-change", "pre-auto-gc", "post-rewrite"]) {
      writeFileSync(join(hooks, name), `#!/bin/sh\necho ${name} >> '${marker}'\nexit 0\n`, { mode: 0o755 });
    }
    mkdirSync(join(dir, "sub"));
    plantGit(dir, [["core.worktree", join(dir, "sub")], ["core.hooksPath", hooks]]);

    expect(await afterPlant(dir, ctx)).toEqual({ kind: "folder", root: real, ids: ["cp-0001"], save: "cp-0002" });
    await tm.recover(ctx, "cp-0001");
    expect(existsSync(marker)).toBe(false);
  });
});

describe("the store is private to this user (F2)", () => {
  test("store home, project store, objects, saved files, notes, reports and the recovery copy of a 0700 folder are closed to others; a loose existing home is tightened", async () => {
    const root = tempDir("perms");
    const dir = join(root, "Documents");
    const store = join(root, "store");
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
    writeFileSync(join(dir, "diary.md"), "private text\n", { mode: 0o600 });
    mkdirSync(store);
    chmodSync(store, 0o755); // a store home made before this fix
    const ctx: tm.Ctx = { cwd: dir, tmHome: store, env: { ...process.env, TM_HOME: store } };
    tm.protect(ctx);
    const { checkpoint } = await tm.checkpoint(ctx, { note: "x", trigger: "auto" });
    tm.setNote(ctx, { id: checkpoint.id, title: "t" });
    const r = await tm.recover(ctx, checkpoint.id);

    const s = tm.storeDirFor(ctx);
    const objects = join(s, "objects");
    const blobs = readdirSync(objects).flatMap((d) => readdirSync(join(objects, d)).map((f) => join(objects, d, f)));
    const reports = readdirSync(join(s, "reports")).map((f) => join(s, "reports", f));
    expect(blobs.length).toBeGreaterThan(0);
    expect(reports.length).toBeGreaterThan(0);
    for (const path of [store, s, objects, ...blobs, join(s, "notes.json"), join(s, "recovery-copies.json"), ...reports, r.copyDir]) {
      expect({ path, others: statSync(path).mode & 0o077 }).toEqual({ path, others: 0 });
    }
    for (const blob of blobs) expect(statSync(blob).mode & 0o777).toBe(0o400);
    expect(statSync(r.copyDir).mode & 0o777).toBe(0o700);
  });
});

describe("a timemachine.yml in the folder does not change what is saved (F4)", () => {
  test("capture.untracked false and config.plain in the folder's yml: every file is still saved, and the .env value is nowhere in the store", async () => {
    const root = tempDir("folderyml");
    const dir = join(root, "shared-notes");
    const store = join(root, "store");
    mkdirSync(dir);
    writeFileSync(join(dir, "chapter.md"), "My only copy of chapter 1\n");
    writeFileSync(join(dir, "timemachine.yml"), "version: 1\ncapture:\n  untracked: false\nconfig:\n  files: [.env]\n  plain: [DB_PASSWORD]\n");
    writeFileSync(join(dir, ".env"), "DB_PASSWORD=fakevalue123\n");
    const ctx: tm.Ctx = { cwd: dir, tmHome: store, env: { ...process.env, TM_HOME: store } };
    tm.protect(ctx);
    const { checkpoint } = await tm.checkpoint(ctx, { note: "Auto save", trigger: "auto" });
    expect(checkpoint.files).toBe(2); // chapter.md and the yml itself, saved as plain data
    const r = await tm.recover(ctx, checkpoint.id);
    expect(readFileSync(join(r.copyDir, "chapter.md"), "utf8")).toBe("My only copy of chapter 1\n");
    expect(storeText(store)).not.toContain("fakevalue123");
  });

  test("a broken timemachine.yml in the folder does not stop saving", async () => {
    const { dir, ctx } = await savedFolder("folderyml-broken");
    writeFileSync(join(dir, "timemachine.yml"), "version: 1\ncapture: [oops\n");
    expect((await tm.checkpoint(ctx, { note: "Auto save", trigger: "auto" })).checkpoint.id).toBe("cp-0002");
  });
});

describe("recovery copy name (F6)", () => {
  test("links at the copy names, live or dangling, are skipped: the copy goes to the next free name and nothing is written through them", async () => {
    const { root, ctx } = await savedFolder("dest", "Notes");
    const victim = join(root, "victim");
    mkdirSync(victim);
    symlinkSync(victim, join(root, "Notes-recovered-cp-0001"));
    symlinkSync(join(root, "nowhere"), join(root, "Notes-recovered-cp-0001-2"));
    const r = await tm.recover(ctx, "cp-0001");
    expect(basename(r.copyDir)).toBe("Notes-recovered-cp-0001-3");
    expect(readFileSync(join(r.copyDir, "notes.md"), "utf8")).toBe("hello\n");
    expect(readdirSync(victim)).toEqual([]);
    expect(existsSync(join(root, "nowhere"))).toBe(false);
    expect(lstatSync(join(root, "Notes-recovered-cp-0001-2")).isSymbolicLink()).toBe(true);
  });
});

describe("letter case (F9)", () => {
  test("the same folder spelled in another case finds the same history", async () => {
    const { root, ctx } = await savedFolder("case", "Notes");
    const lower: tm.Ctx = { ...ctx, cwd: join(root, "notes") };
    if (!existsSync(lower.cwd)) return; // a case-sensitive volume: the two spellings are different folders
    expect(tm.protect(lower, { dryRun: true })).toEqual(tm.protect(ctx, { dryRun: true }));
    expect((await tm.timeline(lower)).checkpoints.map((c) => c.id)).toEqual(["cp-0001"]);
    expect(tm.storeDirFor(lower)).toBe(tm.storeDirFor(ctx));
  });
});
