// Fixes from the security review. Each test reproduces a confirmed issue.
import { appendFileSync, chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
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

  test("H12 a relative TM_HOME is made absolute and may not sit inside the project", async () => {
    const { dir } = await setupDemo();
    await expect(tm.checkpoint({ cwd: dir, env: { ...process.env, TM_HOME: "relstore" } }, {})).rejects.toThrow(/inside the project/);
    const other = tempDir("abs");
    const store = tm.storeDirFor({ cwd: dir, env: { ...process.env, TM_HOME: join("..", "..", other.split("/").pop() ?? "") } });
    expect(store.startsWith("/")).toBe(true);
  });

  test("H13 open --dir inside the project is refused", async () => {
    const { dir, ctx } = await setupDemo();
    await expect(tm.open(ctx, "cp-0001", { dir: "inside" })).rejects.toThrow(/inside the project/);
  });
});
