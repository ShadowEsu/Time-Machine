// Fixes from the security and honesty review: hook command health, ignored files in coverage,
// prompts that hold secret values, the turn prompt, attribution, cleanup and small guards.
import { existsSync, linkSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { clipSafe } from "../src/secrets.ts";
import { git, write } from "../../../fixtures/demo/build.ts";
import { setupDemo, tempDir } from "../../../fixtures/demo/setup.ts";

const entryOf = async (ctx: tm.Ctx, id: string): Promise<tm.TimelineEntry | undefined> => (await tm.timeline(ctx)).checkpoints.find((c) => c.id === id);
const q = (s: string): string => `"${s}"`;

/** A command that prints `version` for --version, like a real tm would. */
function fakeTm(version: string): string {
  const dir = tempDir("fake-tm");
  const script = join(dir, "tm.mjs");
  writeFileSync(script, `if (process.argv.includes("--version")) { console.log(${JSON.stringify(version)}); } else { process.exit(0); }\n`);
  return `${q(process.execPath)} ${q(script)}`;
}

describe("B1 hook command health", () => {
  test("the pinned npx fallback names an exact version", () => {
    expect(tm.npxHookCommand("1.2.3")).toBe("npx -y timetm@1.2.3");
  });

  test("probeHookCommand passes only when --version prints the expected version", async () => {
    const cwd = tempDir("probe");
    expect(await tm.probeHookCommand(fakeTm("0.1.0"), "0.1.0", cwd)).toBe(true);
    expect(await tm.probeHookCommand(fakeTm("9.9.9"), "0.1.0", cwd)).toBe(false);
    expect(await tm.probeHookCommand(`${q(process.execPath)} ${q(join(cwd, "missing.mjs"))}`, "0.1.0", cwd)).toBe(false);
  });

  test("hookStatus says connected only when the lines are there and the command runs", async () => {
    const { ctx } = await setupDemo();
    const good = fakeTm("0.1.0");
    const none = await tm.hookStatus(ctx, { command: good, version: "0.1.0" });
    expect(none.state).toBe("not-connected");
    expect(none.runs).toBeNull();
    await tm.hookInstall(ctx, { command: good });
    const ok = await tm.hookStatus(ctx, { command: good, version: "0.1.0" });
    expect(ok.state).toBe("connected");
    expect(ok.runs).toBe(true);
  });

  test("lines that call a command that does not run are reported as not running, never connected", async () => {
    const { ctx } = await setupDemo();
    const broken = `${q(process.execPath)} ${q(join(tempDir("gone"), "tm.mjs"))}`;
    await tm.hookInstall(ctx, { command: broken });
    const s = await tm.hookStatus(ctx, { command: broken, version: "0.1.0" });
    expect(s.present).toEqual(["UserPromptSubmit", "PreToolUse", "Stop"]);
    expect(s.runs).toBe(false);
    expect(s.state).toBe("not-running");
  });
});

describe("#2 coverage names files .gitignore skips", () => {
  test("a project with ignored paths lists them under what is not saved, without making the check incomplete", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, ".gitignore", "node_modules/\ndist/\n");
    write(dir, "node_modules/left-pad/index.js", "module.exports = 1;\n");
    write(dir, "dist/app.js", "built\n");
    const r = await tm.checkpoint(ctx, { note: "with ignored files" });
    const line = r.checkpoint.coverage.manual.find((l) => l.includes(".gitignore"));
    expect(line).toMatch(/not saved/);
    expect(line).toContain("node_modules/");
    expect(line).toContain("dist/");
    expect(r.checkpoint.coverage.missing.join("\n")).not.toContain(".gitignore");
  });

  test("a project with nothing ignored has no such line", async () => {
    const { ctx } = await setupDemo();
    const c = (await tm.timeline(ctx)).checkpoints.at(-1);
    expect(c?.coverage.manual.join("\n")).not.toContain(".gitignore");
  });
});

describe("#5 undoRecover refuses folders it did not make", () => {
  test("refuses the project root as the copy, and keeps the folder and branch", async () => {
    const { dir, ctx } = await setupDemo();
    const r = await tm.recover(ctx, "cp-0003");
    await expect(tm.undoRecover(ctx, { id: r.id, branch: r.branch, copyDir: dir })).rejects.toThrow(tm.TmError);
    expect(existsSync(join(dir, "timemachine.yml"))).toBe(true);
    expect(git(dir, "branch", "--list", r.branch).trim()).not.toBe("");
    expect(existsSync(r.copyDir)).toBe(true);
  });

  test("refuses an unrelated existing folder and leaves it alone", async () => {
    const { ctx } = await setupDemo();
    const r = await tm.recover(ctx, "cp-0003");
    const other = tempDir("unrelated");
    write(other, "keep.txt", "mine\n");
    await expect(tm.undoRecover(ctx, { id: r.id, branch: r.branch, copyDir: other })).rejects.toThrow(/not a recovery copy/);
    expect(readFileSync(join(other, "keep.txt"), "utf8")).toBe("mine\n");
    expect(git(ctx.cwd, "branch", "--list", r.branch).trim()).not.toBe("");
  });

  test("changes under an ignored folder are named by the folder, not listed file by file", async () => {
    const { ctx } = await setupDemo();
    const r = await tm.recover(ctx, "cp-0003");
    write(r.copyDir, ".gitignore", "node_modules/\n");
    for (let i = 0; i < 20; i++) write(r.copyDir, `node_modules/pkg${i}/index.js`, "x\n");
    const err = await tm.undoRecover(ctx, { id: r.id, branch: r.branch, copyDir: r.copyDir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(tm.TmError);
    const msg = (err as Error).message;
    expect(msg).toContain("node_modules");
    expect(msg).toMatch(/ignored by Git/);
    expect(msg).not.toContain("pkg1");
    expect(existsSync(r.copyDir)).toBe(true);
  });
});

describe("#6 prompts that hold a secret are never stored", () => {
  test("a prompt holding a current secret value from the project is hidden everywhere", async () => {
    const { dir, ctx } = await setupDemo();
    const value = "plainvaluexyz42";
    write(dir, ".env", `PORT=3000\nSESSION_SALT=${value}\n`);
    await tm.runHook(ctx, "prompt", { cwd: dir, prompt: `use ${value} for the salt` });
    const id = (await tm.timeline(ctx)).checkpoints.at(-1)?.id ?? "";
    expect(id).toBe("cp-0007");
    expect((await entryOf(ctx, id))?.agent?.prompt).toMatch(/hidden/);
    const store = tm.storeDirFor(ctx);
    expect(readFileSync(join(store, "checkpoints", `${id}.json`), "utf8")).not.toContain(value);
    expect(readFileSync(join(store, "agent-turn.json"), "utf8")).not.toContain(value);
    expect(JSON.stringify(await tm.timeline(ctx))).not.toContain(value);
  });

  test("a DATABASE_URL value and a postgres URL with a password are never stored", async () => {
    const { dir, ctx } = await setupDemo();
    const inEnv = "postgres://app:hunter2pass@db.internal:5432/app";
    const other = "postgresql://admin:s3cretpw@10.0.0.5/prod";
    write(dir, ".env", `PORT=3000\nDATABASE_URL=${inEnv}\n`);
    await tm.runHook(ctx, "prompt", { cwd: dir, prompt: `connect with ${inEnv} please` });
    write(dir, "draft.txt", "x\n");
    await tm.runHook(ctx, "prompt", { cwd: dir, prompt: `try ${other}` });
    const store = tm.storeDirFor(ctx);
    const all = readdirSync(join(store, "checkpoints")).map((f) => readFileSync(join(store, "checkpoints", f), "utf8")).join("\n");
    for (const s of [inEnv, other, "hunter2pass", "s3cretpw"]) {
      expect(all).not.toContain(s);
      expect(JSON.stringify(await tm.timeline(ctx))).not.toContain(s);
      expect(readFileSync(join(store, "agent-turn.json"), "utf8")).not.toContain(s);
    }
  });

  test("a URL with credentials looks secret, one without does not", () => {
    expect(clipSafe("see mysql://root:pw123@localhost/db", 120)).toMatch(/hidden/);
    expect(clipSafe("open https://example.com/path@v1", 120)).toBe("open https://example.com/path@v1");
  });
});

describe("#7 a save point never carries the previous turn's prompt", () => {
  test("when the prompt save point fails, the next save point names the new prompt", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "a.txt", "1\n");
    expect((await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "first task" })).checkpoint).toBe("cp-0007");
    // Force the next save point to fail: its ref is locked.
    write(dir, "a.txt", "2\n");
    const lock = join(dir, ".git", "refs", "tm", "cp-0008.lock");
    writeFileSync(lock, "");
    const failed = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "second task" });
    expect(failed.checkpoint).toBeNull();
    expect(failed.message).toMatch(/skipped/);
    rmSync(lock);
    const r = await tm.runHook(ctx, "pre-bash", { cwd: dir, tool_input: { command: "rm -rf build" } });
    expect((await entryOf(ctx, r.checkpoint ?? ""))?.agent).toEqual({ name: "Claude Code", prompt: "second task" });
  });

  test("the turn prompt is cleared when the turn stops", async () => {
    const { dir, ctx } = await setupDemo();
    await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "first task" });
    write(dir, "a.txt", "1\n");
    await tm.runHook(ctx, "stop", { cwd: dir });
    expect(existsSync(join(tm.storeDirFor(ctx), "agent-turn.json"))).toBe(false);
    write(dir, "a.txt", "2\n");
    const r = await tm.runHook(ctx, "pre-bash", { cwd: dir, tool_input: { command: "rm -rf build" } });
    expect((await entryOf(ctx, r.checkpoint ?? ""))?.agent).toEqual({ name: "Claude Code" });
  });
});

describe("nits", () => {
  test("clipSafe never cuts an emoji in half", () => {
    const out = clipSafe("😀".repeat(50), 10);
    expect(out).toBe(`${"😀".repeat(7)}...`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
  });

  test("clipSafe strips terminal escapes and bidi controls, so a command cannot restyle or reorder what the user sees", () => {
    const out = clipSafe("rm -rf \u001b[2J\u001b]8;;http://x\u0007dist\u009b31m \u202Etxt.exe\u2066a\u2069\u200Fb\u0000", 120);
    expect(out).toBe("rm -rf [2J]8;;http://xdist31m txt.exeab");
    expect(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(out)).toBe(false);
  });

  test("setCheck refuses a timemachine.yml with another hard link, and leaves both alone", async () => {
    const { dir, ctx } = await setupDemo();
    const path = join(dir, "timemachine.yml");
    const outside = join(dir, "..", "outside.yml");
    linkSync(path, outside);
    const before = readFileSync(outside, "utf8");
    await expect(tm.setCheck(ctx, "npm run build")).rejects.toThrow(/link/);
    expect(readFileSync(outside, "utf8")).toBe(before);
  });

  test("a claude-code trigger alone does not make a save point Claude Code's", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "a.txt", "1\n");
    const r = await tm.checkpoint(ctx, { trigger: "claude-code:prompt" });
    expect((await entryOf(ctx, r.checkpoint.id))?.agent).toBeNull();
  });

  test("cleanStore apply removes only the files the preview showed", async () => {
    const { ctx } = await setupDemo();
    const first = await tm.verify(ctx, "cp-0003");
    await tm.verify(ctx, "cp-0003");
    const preview = await tm.cleanStore(ctx, { apply: false });
    expect(preview.files).toHaveLength(1);
    // A newer check after the preview makes another log removable. Apply must not touch it.
    const second = await tm.verify(ctx, "cp-0006");
    await tm.verify(ctx, "cp-0006");
    const done = await tm.cleanStore(ctx, { apply: true, files: [...preview.files, "logs/../audit.jsonl", "checkpoints/cp-0001.json"] });
    expect(done.files).toEqual(preview.files);
    expect(existsSync(first.log ?? "")).toBe(false);
    expect(existsSync(second.log ?? "")).toBe(true);
    expect(existsSync(join(tm.storeDirFor(ctx), "audit.jsonl"))).toBe(true);
    expect(existsSync(join(tm.storeDirFor(ctx), "checkpoints", "cp-0001.json"))).toBe(true);
  });
});
