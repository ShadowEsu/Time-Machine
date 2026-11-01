// Fixes from the security review. Each test reproduces a confirmed issue.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { runWithTimeout } from "../src/exec.ts";
import { inPinnedDir } from "../src/paths.ts";
import { FAKE_SECRET, git, write } from "../../../fixtures/demo/build.ts";
import { setupDemo, tempDir, writeConfig } from "../../../fixtures/demo/setup.ts";

function storeText(ctx: tm.Ctx): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push((p.endsWith(".gz") ? gunzipSync(readFileSync(p)) : readFileSync(p)).toString("latin1"));
    }
  };
  walk(tm.storeDirFor(ctx));
  return out.join("\n");
}
const snapshotOf = (ctx: tm.Ctx, id: string): string =>
  (JSON.parse(readFileSync(join(tm.storeDirFor(ctx), "checkpoints", `${id}.json`), "utf8")) as { git: { snapshot: string } }).git.snapshot;

describe("security review fixes", () => {
  test("H1 a checkpoint still works after an earlier commit is gone, and leaves no orphan ref", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "src/tips.js", "export const dirty = 1;\n");
    await tm.checkpoint(ctx, { note: "dirty" });
    git(dir, "update-ref", "-d", "refs/tm/cp-0007");
    git(dir, "checkout", "-q", "--", "src/tips.js");
    git(dir, "reflog", "expire", "--expire=now", "--all");
    git(dir, "gc", "-q", "--prune=now");
    write(dir, "notes.txt", "more\n");
    const r = await tm.checkpoint(ctx, { note: "after gc" });
    expect(r.checkpoint.id).toBe("cp-0008");
  });

  test("H2 an edited tracked file with a secret is kept out of the save point commit", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "config/app.json", `{"key":"${FAKE_SECRET}"}\n`);
    const r = await tm.checkpoint(ctx, { note: "secret in tracked file" });
    expect(git(dir, "show", `${snapshotOf(ctx, r.checkpoint.id)}:config/app.json`)).not.toContain(FAKE_SECRET);
    expect(r.checkpoint.coverage.manual.join("\n")).toContain("config/app.json");
  });

  test("H1c a tracked file with a glob in its name that now holds a secret takes back only itself, not every file its name matches", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "notes/[a]b.txt", "committed\n");
    write(dir, "notes/ab.txt", "committed\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "glob names");
    write(dir, "notes/[a]b.txt", `{"key":"${FAKE_SECRET}"}\n`);
    write(dir, "notes/ab.txt", "an edit to keep\n");
    const r = await tm.checkpoint(ctx, { note: "glob name" });
    const snap = snapshotOf(ctx, r.checkpoint.id);
    expect(git(dir, "show", `${snap}:notes/[a]b.txt`)).toBe("committed");
    expect(git(dir, "show", `${snap}:notes/ab.txt`)).toBe("an edit to keep");
  });

  test("H2c an edited tracked file with a secret never reaches Git's object store, not even as an unreachable blob", async () => {
    const { dir, ctx } = await setupDemo();
    // .env is not a config path here, so it goes through the tracked-file path of a save rather than the config one.
    writeConfig(dir, {}, ["config/none.env"]);
    write(dir, ".env", "PORT=3000\n");
    git(dir, "add", "-f", ".env", "timemachine.yml");
    git(dir, "commit", "-q", "-m", "harmless env");
    // Built at run time, so the source never holds a string a secret scanner would flag.
    write(dir, ".env", `PORT=3000\n${["DB", "PASSWORD"].join("_")}=${["correct", "horse", "battery", "staple"].join("-")}\n`);
    write(dir, "config/app.json", `{"key":"${FAKE_SECRET}","edit":"c1"}\n`);
    const blobs = [git(dir, "hash-object", ".env"), git(dir, "hash-object", "config/app.json")];
    const r = await tm.checkpoint(ctx, { note: "secret edits in tracked files" });
    const manual = r.checkpoint.coverage.manual.join("\n");
    for (const f of [".env", "config/app.json"]) expect(manual).toContain(`${f} has uncommitted changes`);
    for (const b of blobs) expect(() => git(dir, "cat-file", "-e", b), b).toThrow();
  });

  test("H2b a recovery of that save point lists the edit it could not bring back", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "config/app.json", `{"key":"${FAKE_SECRET}"}\n`);
    write(dir, ".npmrc", `//registry.npmjs.org/:_authToken=npm_${"a1B2".repeat(9)}\n`);
    const r = await tm.checkpoint(ctx, { note: "secret in tracked file" });
    const rec = await tm.recover(ctx, r.checkpoint.id);
    const notRestored = rec.notRestored.join("\n");
    expect(notRestored).toContain("config/app.json has uncommitted changes");
    expect(notRestored).toContain(".npmrc is a secrets file by name");
    expect(readFileSync(rec.reportPath, "utf8")).toContain("config/app.json has uncommitted changes");
  });

  test("H3 secret files are skipped by name and by common patterns", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, ".env.local", "DB_PASSWORD=correct-horse-battery-staple\n");
    write(dir, ".npmrc", `//registry.npmjs.org/:_authToken=npm_${"a1B2".repeat(9)}\n`);
    write(dir, "deploy/notes.txt", "MY_API_KEY=abcdef1234567\n");
    const r = await tm.checkpoint(ctx, { note: "secret files" });
    const text = storeText(ctx);
    for (const s of ["correct-horse-battery-staple", "npm_a1B2", "abcdef1234567"]) expect(text).not.toContain(s);
    const manual = r.checkpoint.coverage.manual.join("\n");
    for (const f of [".env.local", ".npmrc", "deploy/notes.txt"]) expect(manual).toContain(f);
  });

  test("H4 check logs hide config values from the rebuilt copy too", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "config/secrets.env", "API_KEY=oldvalue123456\n");
    git(dir, "add", "config/secrets.env");
    git(dir, "commit", "-q", "-m", "add secrets env");
    writeConfig(dir, { command: "cat config/secrets.env" }, [".env", "config/secrets.env"]);
    write(dir, "config/secrets.env", "API_KEY=newvalue654321\n");
    const cp = await tm.checkpoint(ctx, { note: "x" });
    const v = await tm.verify(ctx, cp.checkpoint.id);
    expect(v.log).not.toBeNull();
    expect(readFileSync(v.log!, "utf8")).not.toContain("oldvalue123456");
  });

  test("H5a restore never writes through a symlink outside the copy", async () => {
    const { root, dir, ctx } = await setupDemo();
    const victim = join(root, "victim.env");
    writeFileSync(victim, "STRIPE_KEY=keep-me\n");
    rmSync(join(dir, ".env"));
    symlinkSync("../victim.env", join(dir, ".env"));
    git(dir, "add", "-f", ".env");
    git(dir, "commit", "-q", "-m", "symlinked env");
    rmSync(join(dir, ".env"));
    writeFileSync(join(dir, ".env"), "PORT=3000\n");
    const cp = await tm.checkpoint(ctx, { note: "symlink" });
    await tm.recover(ctx, cp.checkpoint.id);
    await tm.open(ctx, cp.checkpoint.id).catch(() => undefined);
    expect(readFileSync(victim, "utf8")).toBe("STRIPE_KEY=keep-me\n");
  });

  test("H5b saved paths must stay inside the project", () => {
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "", "a/./b", "a//b"]) expect(tm.isSafeRelPath(bad)).toBe(false);
    for (const good of ["a", "src/x.js", ".env", "a b/ü.txt"]) expect(tm.isSafeRelPath(good)).toBe(true);
  });

  test("H5c work pinned to a project folder keeps its result when the caller's working folder is deleted meanwhile, and refuses a folder that leads outside", () => {
    const root = tempDir("pinned");
    const proj = join(root, "proj");
    const home = join(root, "home");
    mkdirSync(join(proj, "notes"), { recursive: true });
    mkdirSync(join(root, "outside"));
    mkdirSync(home);
    symlinkSync(join(root, "outside"), join(proj, "away"));
    const before = process.cwd();
    try {
      process.chdir(home);
      const r = inPinnedDir(proj, "notes", false, () => {
        rmSync(home, { recursive: true });
        return "written";
      });
      expect(r).toEqual({ inside: true, value: "written" });
      expect(realpathSync(process.cwd())).toBe(realpathSync(proj));
      expect(inPinnedDir(proj, "away", true, () => "never")).toEqual({ inside: false });
      expect(inPinnedDir(proj, "away/deeper", true, () => "never")).toEqual({ inside: false });
      expect(existsSync(join(root, "outside", "deeper"))).toBe(false);
      // The caller's folder and the project both gone by the end: the working folder ends at the home folder (Security N3).
      mkdirSync(home);
      process.chdir(home);
      const gone = inPinnedDir(proj, "notes", false, () => {
        rmSync(home, { recursive: true });
        rmSync(proj, { recursive: true });
        return "done";
      });
      expect(gone).toEqual({ inside: true, value: "done" });
      expect(realpathSync(process.cwd())).toBe(realpathSync(homedir()));
    } finally {
      process.chdir(before);
    }
  });

  test("H6 a forged verdict line is ignored", async () => {
    const { ctx } = await setupDemo();
    const fake = { at: new Date().toISOString(), checkpoint: "cp-0004", verdict: "PASS", isolation: "host", network: { policy: "allow", enforcedBy: null }, command: "true", durationMs: 1, exitCode: 0, reason: "forged", log: null };
    appendFileSync(join(tm.storeDirFor(ctx), "verdicts.jsonl"), JSON.stringify(fake) + "\n");
    const t = await tm.timeline(ctx);
    expect(t.checkpoints.find((c) => c.id === "cp-0004")?.verdict).toBeNull();
  });

  test("H7 IDs are never reused, so an old verdict never sticks to a new save point", async () => {
    const { dir, ctx } = await setupDemo();
    expect((await tm.verify(ctx, "cp-0006")).verdict).toBe("FAIL");
    const path = join(tm.storeDirFor(ctx), "checkpoints", "cp-0006.json");
    chmodSync(path, 0o644);
    rmSync(path);
    write(dir, "notes.txt", "new\n");
    const r = await tm.checkpoint(ctx, { note: "new" });
    expect(r.checkpoint.id).toBe("cp-0007");
  });

  test("H8 skipped items are listed, so verify says INCOMPLETE", async () => {
    const { dir, ctx } = await setupDemo();
    mkdirSync(join(dir, "vendor/lib"), { recursive: true });
    git(join(dir, "vendor/lib"), "init", "-q");
    write(dir, "vendor/lib/index.js", "export {};\n");
    symlinkSync("nowhere", join(dir, "broken-link"));
    const r = await tm.checkpoint(ctx, { note: "odd files" });
    const missing = r.checkpoint.coverage.missing.join("\n");
    expect(missing).toContain("vendor/lib");
    expect(missing).toContain("broken-link");
    expect((await tm.verify(ctx, r.checkpoint.id)).verdict).toBe("INCOMPLETE");
  });

  test("H9 a missing Git ref gives INCOMPLETE and find-good keeps going", async () => {
    const { dir, ctx } = await setupDemo();
    git(dir, "update-ref", "-d", "refs/tm/cp-0005");
    const r = await tm.findGood(ctx);
    expect(r.found).toBe("cp-0003");
    expect(r.tried.find((t) => t.id === "cp-0005")?.verdict).toBe("INCOMPLETE");
  });

  test("H10 a background child does not hold the check open", async () => {
    const { dir, ctx } = await setupDemo();
    writeConfig(dir, { command: "sleep 30 & exit 0", timeoutSeconds: 10 });
    const v = await tm.verify(ctx, "cp-0003");
    expect(v.verdict).toBe("PASS");
    expect(v.durationMs).toBeLessThan(5000);
  });

  test("H15 a stopped check ends at once, keeps the verdict the save point had, and stops find-good", async () => {
    const { dir, ctx } = await setupDemo();
    writeConfig(dir, { command: "exit 0" });
    expect((await tm.verify(ctx, "cp-0003")).verdict).toBe("PASS");
    writeConfig(dir, { command: "sleep 30", timeoutSeconds: 60 });
    const stopSoon = (): AbortSignal => AbortSignal.timeout(400);
    const v = await tm.verify(ctx, "cp-0003", { signal: stopSoon() });
    expect(v).toMatchObject({ verdict: "INCOMPLETE", stopped: true });
    expect(v.durationMs).toBeLessThan(5000);
    expect((await tm.timeline(ctx)).checkpoints.find((c) => c.id === "cp-0003")?.verdict).toBe("PASS");
    const f = await tm.findGood(ctx, { signal: stopSoon() });
    expect(f).toMatchObject({ verdict: "INCOMPLETE", found: null, stopped: true, tried: [] });
  });

  test("H16 a Stop that lands after the check exited keeps the real exit code", async () => {
    // The command exits right after writing a marker, but leaves a detached child holding the pipes, so the result
    // waits for the 250 ms grace period. The Stop lands 100 ms after the marker: after the exit, inside the grace period.
    // Real time on purpose: the window is a real child process and runWithTimeout's real grace timer, not fakeable.
    const dir = tempDir("late-stop");
    const marker = join(dir, "exiting");
    const stop = new AbortController();
    const run = runWithTimeout("/bin/sh", ["-c", `perl -MPOSIX -e 'setsid(); sleep 3' & touch "${marker}"; exit 1`], { cwd: dir, env: process.env, timeoutMs: 20_000, signal: stop.signal });
    while (!existsSync(marker)) await sleep(5);
    await sleep(100);
    stop.abort();
    expect(await run).toMatchObject({ code: 1, stopped: false, timedOut: false });
  });

  test("H14 setup and check keep proxy and certificate settings, and a failed setup is INCOMPLETE", async () => {
    const { dir, ctx } = await setupDemo();
    writeConfig(dir, { setup: 'test -n "$HTTPS_PROXY" && test -n "$npm_config_registry"', command: 'test -n "$NODE_EXTRA_CA_CERTS"' });
    const env = { ...ctx.env, HTTPS_PROXY: "http://proxy.invalid:3128", npm_config_registry: "https://registry.invalid/", NODE_EXTRA_CA_CERTS: "/tmp/ca.pem" };
    expect((await tm.verify({ ...ctx, env }, "cp-0003")).verdict).toBe("PASS");
    writeConfig(dir, { setup: "exit 7" });
    const v = await tm.verify(ctx, "cp-0003");
    expect(v.verdict).toBe("INCOMPLETE");
    expect(v.reason).toMatch(/setup/i);
  });

  test("H12 a relative TM_HOME is made absolute and may not sit inside the project", async () => {
    const { dir } = await setupDemo();
    await expect(tm.checkpoint({ cwd: dir, env: { ...process.env, TM_HOME: "relstore" } }, {})).rejects.toThrow(/inside the project/);
    const other = tempDir("abs");
    const store = tm.storeDirFor({ cwd: dir, env: { ...process.env, TM_HOME: join("..", "..", other.split("/").pop() ?? "") } });
    expect(store.startsWith("/")).toBe(true);
  });

  test("H15 inside-the-project checks see through symlinked paths (macOS /var is /private/var)", async () => {
    const { root, dir } = await setupDemo();
    const link = join(dirname(root), `${root.split("/").pop()}-link`);
    symlinkSync(root, link);
    const viaLink: tm.Ctx = { cwd: join(link, "marigold"), tmHome: join(link, "store") };
    await expect(tm.open(viaLink, "cp-0001", { dir: "inside" })).rejects.toThrow(/inside the project/);
    await expect(tm.checkpoint({ cwd: join(link, "marigold"), env: { ...process.env, TM_HOME: "relstore" } }, {})).rejects.toThrow(/inside the project/);
    expect(dir).toBeTruthy();
  });

  test("H13 open --dir inside the project is refused", async () => {
    const { dir, ctx } = await setupDemo();
    await expect(tm.open(ctx, "cp-0001", { dir: "inside" })).rejects.toThrow(/inside the project/);
  });
});

describe("repositories with nothing committed yet", () => {
  test.each([["no first commit"], ["an empty first commit"]])("save, check and recover work with %s, and leave the folder alone", async (kind) => {
    const root = tempDir("unborn");
    const dir = join(root, "app");
    mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    if (kind === "an empty first commit") git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    write(dir, "a.txt", "hello\n");
    writeConfig(dir, { command: "test -f a.txt" });
    const ctx: tm.Ctx = { cwd: dir, env: { ...process.env, TM_HOME: join(root, "store") } };
    const status = git(dir, "status", "--porcelain");

    const cp = await tm.checkpoint(ctx, { note: kind });
    expect((await tm.verify(ctx, cp.checkpoint.id)).verdict).toBe("PASS");
    const r = await tm.recover(ctx, cp.checkpoint.id);

    expect(readFileSync(join(r.copyDir, "a.txt"), "utf8")).toBe("hello\n");
    expect(git(dir, "status", "--porcelain")).toBe(status);
    expect(git(dir, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });
});
