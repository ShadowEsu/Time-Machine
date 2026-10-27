// First-run signals: the user sees the save point before a risky command, init says plainly when
// there is no check, and status tells the setup skill what is missing.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { FAKE_TOKEN, git, write } from "../../../fixtures/demo/build.ts";
import { setupDemo, tempDir, writeConfig } from "../../../fixtures/demo/setup.ts";

function repo(files: Record<string, string>): { dir: string; tmHome: string; ctx: tm.Ctx } {
  const root = tempDir("activation");
  const dir = join(root, "app");
  for (const [name, text] of Object.entries(files)) write(dir, name, text);
  git(root, "init", "-q", "-b", "main", dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  const tmHome = join(root, "store");
  return { dir, tmHome, ctx: { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } } };
}

const guarded = { requireConfig: true };
const bash = (command: string) => ({ tool_input: { command } });

describe("the save point before a risky command is shown to the user", () => {
  test("a new save point before a risky command carries one systemMessage line", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "draft.txt", "unsaved work\n");
    const r = await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash("git reset --hard") });
    expect(r).toEqual({ event: "pre-bash", exitCode: 0, checkpoint: "cp-0007", verdict: null, message: "", systemMessage: "Time Machine saved cp-0007 before git reset --hard." });
  });

  test("nothing is shown when no save point was made: unchanged, not risky, or not approved", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "draft.txt", "unsaved work\n");
    expect((await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash("rm -rf src") })).systemMessage).toBeDefined();
    const unchanged = await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash("rm -rf src") });
    expect(unchanged.checkpoint).toBe("cp-0007");
    expect(unchanged.systemMessage).toBeUndefined();
    write(dir, "draft.txt", "more work\n");
    expect(await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash("ls -la") })).toEqual({ event: "pre-bash", exitCode: 0, checkpoint: null, verdict: null, message: "" });
    // The plugin: a timemachine.yml nobody approved here makes no save point and shows nothing.
    expect(await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash("rm -rf src") }, guarded)).toEqual({ event: "pre-bash", exitCode: 0, checkpoint: null, verdict: null, message: "" });
  });

  test("the plugin hook shows the line once the check is approved", async () => {
    const { dir, ctx } = await setupDemo();
    await tm.init(ctx);
    write(dir, "draft.txt", "unsaved work\n");
    const r = await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash("git clean -f") }, guarded);
    expect(r.systemMessage).toBe("Time Machine saved cp-0007 before git clean -f.");
  });

  test("the command is clipped to about 60 characters and never shows a secret", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "draft.txt", "1\n");
    const long = `rm -rf ${"build/very/deep/folder/".repeat(4)}`;
    const clipped = (await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash(long) })).systemMessage ?? "";
    expect(clipped).toBe(`Time Machine saved cp-0007 before ${long.slice(0, 57)}...`);
    write(dir, "draft.txt", "2\n");
    const token = (await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash(`curl -H "Authorization: Bearer ${FAKE_TOKEN}" x && rm -rf dist`) })).systemMessage ?? "";
    expect(token).toBe("Time Machine saved cp-0008 before a risky command.");
    // A value from the project's .env is hidden too, even when it does not look like a secret.
    write(dir, ".env", "PORT=3000\nPASSPHRASE=marigold-orchard-42\n");
    write(dir, "draft.txt", "3\n");
    const fromEnv = await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash("rm -rf /srv/marigold-orchard-42") });
    expect(fromEnv.systemMessage).toBe("Time Machine saved cp-0009 before a risky command.");
  });

  test("prompt and stop never show a line, so nothing nags every turn", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "draft.txt", "unsaved work\n");
    const prompt = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "fix the tips" });
    expect(prompt.checkpoint).toBe("cp-0007");
    expect(prompt.systemMessage).toBeUndefined();
    write(dir, "draft.txt", "more\n");
    const stop = await tm.runHook(ctx, "stop", { cwd: dir });
    expect(stop.checkpoint).toBe("cp-0008");
    expect(stop.systemMessage).toBeUndefined();
  });
});

describe("tm init with no test command", () => {
  test("records no consent for an empty check, and approves once verify.command is set", async () => {
    const { dir, ctx } = repo({ "package.json": JSON.stringify({ name: "app", scripts: { start: "node index.js" } }), "index.js": "1;\n" });
    const r = await tm.init(ctx);
    expect(r).toMatchObject({ created: true, verifyCommand: "", approvedCheck: null });
    expect(existsSync(join(tm.storeDirFor(ctx), "consent.json"))).toBe(false);
    expect(await tm.init(ctx)).toMatchObject({ created: false, approvedCheck: null });
    expect(existsSync(join(tm.storeDirFor(ctx), "consent.json"))).toBe(false);
    expect(await tm.init(ctx, { approve: false })).toMatchObject({ approvedCheck: null });
    writeConfig(dir, { command: "node --test" });
    expect(await tm.init(ctx)).toMatchObject({ approvedCheck: "node --test" });
  });
});

describe("tm status", () => {
  test("says whether the project is set up and its check approved, and never makes a store", async () => {
    const { dir, tmHome, ctx } = repo({ "package.json": JSON.stringify({ name: "app", scripts: { test: "node --test" } }) });
    expect(tm.status(ctx)).toEqual({ initialized: false, approved: false, check: null });
    expect(existsSync(tmHome)).toBe(false);
    await tm.init(ctx, { approve: false });
    expect(tm.status(ctx)).toEqual({ initialized: true, approved: false, check: "npm test" });
    await tm.init(ctx);
    expect(tm.status(ctx)).toEqual({ initialized: true, approved: true, check: "npm test" });
    writeConfig(dir, { command: "" });
    expect(tm.status(ctx)).toEqual({ initialized: true, approved: false, check: null });
  });
});
