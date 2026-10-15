// Phase A acceptance tests V01 to V14 from docs/BUILD_BRIEF.md.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { beforeAll, describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { FAKE_SECRET, FAKE_TOKEN, git, write } from "../../../fixtures/demo/build.ts";
import { fileMap, setupDemo, snapshotState, tempDir, writeConfig, type Demo } from "../../../fixtures/demo/setup.ts";

interface StoredFile { path: string; sha256: string }
function manifestOf(ctx: tm.Ctx, id: string): { files: StoredFile[]; git: { snapshot: string } } {
  return JSON.parse(readFileSync(join(tm.storeDirFor(ctx), "checkpoints", `${id}.json`), "utf8")) as { files: StoredFile[]; git: { snapshot: string } };
}
function blobPath(ctx: tm.Ctx, sha: string): string {
  return join(tm.storeDirFor(ctx), "objects", sha.slice(0, 2), `${sha.slice(2)}.gz`);
}

let shared: Demo;
beforeAll(async () => {
  shared = await setupDemo();
});

describe("Phase A acceptance", () => {
  test("V01 open, verify and find-good never modify the working copy or current branch", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "notes.txt", "draft, not committed\n");
    write(dir, "src/tips.js", "// edited but not saved to Git\n");
    const before = snapshotState(dir);
    const opened = await tm.open(ctx, "cp-0002");
    await tm.verify(ctx, "cp-0004");
    await tm.findGood(ctx);
    expect(snapshotState(dir)).toEqual(before);
    expect(opened.dir.startsWith(dir)).toBe(false);
  });

  test("V02 uncommitted changes restore exactly", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "src/tips.js", "export const wip = 1;\n");
    rmSync(join(dir, "test/split.test.js"));
    write(dir, "src/new-feature.ts", "export const draft = true;\n");
    write(dir, "src/staged.ts", "export const staged = true;\n");
    git(dir, "add", "src/staged.ts");
    const cp = await tm.checkpoint(ctx, { note: "Work in progress" });
    expect(cp.checkpoint.dirty).toBe(true);
    const opened = await tm.open(ctx, cp.checkpoint.id);
    expect(fileMap(opened.dir)).toEqual(fileMap(dir));
    expect(existsSync(join(opened.dir, "test/split.test.js"))).toBe(false);
  });

  test("V03 secret values never appear in the store, logs or reports", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "notes/keys.txt", `token ${FAKE_TOKEN}\n`);
    const cp = await tm.checkpoint(ctx, { note: "With a secret file" });
    const results = [cp, await tm.verify(ctx, cp.checkpoint.id), await tm.recover(ctx, "cp-0003"), await tm.timeline(ctx), await tm.log(ctx)];
    const text = JSON.stringify(results);
    for (const secret of [FAKE_SECRET, FAKE_TOKEN]) {
      expect(text).not.toContain(secret);
      expect(readStoreText(ctx)).not.toContain(secret);
    }
    expect(cp.checkpoint.coverage.manual.join("\n")).toContain("STRIPE_SECRET_KEY");
    expect(cp.checkpoint.coverage.manual.join("\n")).toContain("notes/keys.txt");
    for (const id of ["cp-0003", cp.checkpoint.id]) {
      const snap = manifestOf(ctx, id).git.snapshot;
      const tree = git(dir, "ls-tree", "-r", "--name-only", snap);
      expect(tree).not.toContain(".env");
      expect(tree).not.toContain("notes/keys.txt");
    }
  });

  test("V04 a missing captured file gives INCOMPLETE, not PASS", async () => {
    const { ctx } = await setupDemo();
    const themes = manifestOf(ctx, "cp-0003").files.find((f) => f.path === "data/themes.json");
    expect(themes).toBeDefined();
    rmSync(blobPath(ctx, themes!.sha256), { force: true });
    const v = await tm.verify(ctx, "cp-0003");
    expect(v.verdict).toBe("INCOMPLETE");
    expect(v.reason).toContain("data/themes.json");
  });

  test("V05 a tampered checkpoint is rejected", async () => {
    const { ctx } = await setupDemo();
    const path = join(tm.storeDirFor(ctx), "checkpoints", "cp-0002.json");
    chmodSync(path, 0o644);
    writeFileSync(path, readFileSync(path, "utf8").replace("Added split bill", "Totally safe"));
    const v = await tm.verify(ctx, "cp-0002");
    expect(v.verdict).toBe("ERROR");
    expect(v.reason).toMatch(/integrity/i);
    await expect(tm.open(ctx, "cp-0002")).rejects.toThrow(/integrity/i);

    const themes = manifestOf(ctx, "cp-0003").files.find((f) => f.path === "data/themes.json")!;
    const blob = blobPath(ctx, themes.sha256);
    chmodSync(blob, 0o644);
    writeFileSync(blob, gzipSync(Buffer.from('["light"]\n')));
    const v2 = await tm.verify(ctx, "cp-0003");
    expect(v2.verdict).toBe("ERROR");
    expect(v2.reason).toMatch(/integrity/i);
  });

  test("V06 verify gives FAIL for a broken state and PASS for a working one", async () => {
    const broken = await tm.verify(shared.ctx, "cp-0004");
    expect(broken.verdict).toBe("FAIL");
    expect(tm.EXIT_CODES[broken.verdict]).toBe(1);
    const working = await tm.verify(shared.ctx, "cp-0003");
    expect(working.verdict).toBe("PASS");
    expect(tm.EXIT_CODES[working.verdict]).toBe(0);
  });

  test("V07 find-good returns the newest passing checkpoint in the demo history", async () => {
    const r = await tm.findGood(shared.ctx);
    expect(r.verdict).toBe("PASS");
    expect(r.found).toBe("cp-0003");
    expect(r.tried.map((t) => t.id)).toEqual(["cp-0006", "cp-0005", "cp-0004", "cp-0003"]);
  });

  test("V08 recover creates a local branch, never pushes, lists manual steps", async () => {
    const { root, dir, ctx } = await setupDemo();
    const remote = join(root, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    git(dir, "remote", "add", "origin", remote);
    git(dir, "push", "-q", "origin", "main");
    const remoteBefore = git(dir, "ls-remote", "origin");
    const before = snapshotState(dir);

    const r = await tm.recover(ctx, "cp-0003");

    expect(r.branch).toBe("tm/recover/cp-0003");
    expect(git(dir, "rev-parse", r.branch)).toBe(manifestOf(ctx, "cp-0003").git.snapshot);
    expect(git(dir, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(git(dir, "ls-remote", "origin")).toBe(remoteBefore);
    expect(r.pushed).toBe(false);
    expect(r.savedBefore).toBe("cp-0007");
    expect(r.manualSteps.join("\n")).toContain("STRIPE_SECRET_KEY");
    expect(r.notRestored.join("\n").toLowerCase()).toContain("secret values");
    expect(existsSync(join(r.copyDir, "data/themes.json"))).toBe(true);
    expect(readFileSync(r.reportPath, "utf8").trim().endsWith("Restored: code, captured files, config. Not restored: database, deployed version, secret values.")).toBe(true);
    execFileSync("node", ["--test"], { cwd: r.copyDir, stdio: "ignore" });
    const after = snapshotState(dir);
    expect({ ...after, branches: undefined }).toEqual({ ...before, branches: undefined });
  });

  test("V09 a timeout ends as ERROR with a clear message", async () => {
    const { dir, ctx } = await setupDemo();
    writeConfig(dir, { command: 'node -e "setTimeout(() => {}, 20000)"', timeoutSeconds: 1 });
    const v = await tm.verify(ctx, "cp-0003");
    expect(v.verdict).toBe("ERROR");
    expect(v.reason).toMatch(/timed out after 1 s/i);
    expect(v.durationMs).toBeLessThan(10_000);
  });

  test("V10 network use during verify is BLOCKED when the policy is off and it cannot be enforced", async () => {
    const { dir, ctx } = await setupDemo();
    writeConfig(dir, { network: "deny" });
    const v = await tm.verify({ ...ctx, env: { ...ctx.env, TM_SANDBOX: "none" } }, "cp-0003");
    expect(v.verdict).toBe("BLOCKED");
    expect(v.reason).toMatch(/sandbox/i);
    expect(v.network.policy).toBe("deny");
  });

  test.runIf(process.platform === "linux")("V10b with a sandbox, verify really runs without a network", async () => {
    const { dir, ctx } = await setupDemo();
    const probe = "node -e \"const n=Object.entries(require('os').networkInterfaces()).filter(([k])=>k!=='lo');process.exit(n.length?1:0)\"";
    writeConfig(dir, { command: probe, network: "deny" });
    const v = await tm.verify(ctx, "cp-0003");
    if (v.verdict === "BLOCKED") return; // no sandbox on this machine: covered by V10
    expect(v.network.enforcedBy).not.toBeNull();
    expect(v.verdict).toBe("PASS");
  });

  test.runIf(process.platform === "linux")("V10c setup can install dependencies with the network, the check runs without it", async () => {
    const { dir, ctx } = await setupDemo();
    const ifaces = "Object.keys(require('os').networkInterfaces()).filter((k)=>k!=='lo').length";
    writeConfig(dir, { setup: `node -e "process.exit(${ifaces} ? 0 : 1)"`, command: `node -e "process.exit(${ifaces} ? 1 : 0)"`, network: "deny" });
    const v = await tm.verify(ctx, "cp-0003");
    if (v.verdict === "BLOCKED") return; // no sandbox on this machine: covered by V10
    expect(v.reason).toBe("The check passed.");
    expect(v.verdict).toBe("PASS");
  });

  test("V11 the audit log records every action", async () => {
    const { ctx } = await setupDemo();
    await tm.init(ctx);
    await tm.open(ctx, "cp-0001");
    await tm.verify(ctx, "cp-0003");
    await tm.findGood(ctx);
    await tm.recover(ctx, "cp-0003");
    const { entries } = await tm.log(ctx);
    const actions = entries.map((e) => e.action);
    expect(actions.filter((a) => a === "checkpoint")).toHaveLength(7);
    for (const a of ["init", "open", "verify", "find-good", "recover"]) expect(actions).toContain(a);
    expect(entries.every((e) => !Number.isNaN(Date.parse(e.at)))).toBe(true);
  });

  test("V13 deleting the project folder does not delete its checkpoints", async () => {
    const { root, dir, ctx } = await setupDemo();
    const snapshots = ["cp-0001", "cp-0002", "cp-0003", "cp-0004", "cp-0005", "cp-0006"].map((id) => manifestOf(ctx, id).git.snapshot);
    const store = tm.storeDirFor(ctx);
    rmSync(dir, { recursive: true, force: true });
    const rebuilt = join(root, "rebuilt");
    execFileSync("git", ["init", "-q", rebuilt]);
    for (const b of readdirSync(join(store, "bundles")).sort()) {
      git(rebuilt, "fetch", "-q", join(store, "bundles", b), "refs/tm/*:refs/tm/*");
    }
    for (const s of snapshots) git(rebuilt, "cat-file", "-e", `${s}^{commit}`);
    expect(readdirSync(join(store, "checkpoints"))).toHaveLength(6);
  });

  test("V14 a host mode PASS is always labeled as host mode", async () => {
    const v = await tm.verify(shared.ctx, "cp-0002");
    expect(v.verdict).toBe("PASS");
    expect(v.isolation).toBe("host");
    const t = await tm.timeline(shared.ctx);
    const entry = t.checkpoints.find((c) => c.id === "cp-0002");
    expect(entry?.isolation).toBe("host");
  });
});

describe("C01 project manifest", () => {
  test("an invalid timemachine.yml is a usage error with the field named", async () => {
    const dir = tempDir("badcfg");
    git(dir, "init", "-q");
    writeFileSync(join(dir, "timemachine.yml"), "version: 1\nverify:\n  timeoutSeconds: -5\n");
    await expect(tm.checkpoint({ cwd: dir, tmHome: tempDir("badcfg-store") }, {})).rejects.toThrow(/timeoutSeconds/);
  });
});

function readStoreText(ctx: tm.Ctx): string {
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
