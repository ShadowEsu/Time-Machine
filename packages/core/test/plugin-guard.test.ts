// The Claude Code plugin runs its hooks in every session in every folder. With requireConfig a hook
// acts only in a project the user opted into with tm init, and is silent everywhere else.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir, writeConfig } from "../../../fixtures/demo/setup.ts";

function repo(): { dir: string; tmHome: string; ctx: tm.Ctx } {
  const root = tempDir("guard");
  const dir = join(root, "app");
  write(dir, "index.js", "export const a = 1;\n");
  git(root, "init", "-q", "-b", "main", dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  const tmHome = join(root, "store");
  return { dir, tmHome, ctx: { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } } };
}

const guarded = { requireConfig: true };

describe("hooks guarded by requireConfig", () => {
  test.each(["prompt", "stop"] as const)("a guarded %s in a Git repo without timemachine.yml makes no save point and no store", async (event) => {
    const { dir, tmHome, ctx } = repo();
    const r = await tm.runHook(ctx, event, { cwd: dir, prompt: "x" }, guarded);
    expect(r).toEqual({ event, exitCode: 0, checkpoint: null, verdict: null, message: "" });
    expect(existsSync(tmHome)).toBe(false);
  });

  test("a guarded prompt in an initialized repo makes a save point", async () => {
    const { dir, ctx } = repo();
    writeConfig(dir);
    const r = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, guarded);
    expect(r.exitCode).toBe(0);
    expect(r.checkpoint).toBe("cp-0001");
    expect((await tm.timeline(ctx)).checkpoints.map((c) => c.id)).toEqual(["cp-0001"]);
  });

  test("a guarded hook outside any Git repo exits 0 with no message", async () => {
    const dir = tempDir("nogit");
    const tmHome = join(dir, "store");
    const ctx: tm.Ctx = { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome, GIT_CEILING_DIRECTORIES: dir } };
    for (const event of ["prompt", "pre-bash", "stop"] as const) {
      const r = await tm.runHook(ctx, event, { cwd: dir, prompt: "x", tool_input: { command: "rm -rf x" } }, guarded);
      expect(r).toEqual({ event, exitCode: 0, checkpoint: null, verdict: null, message: "" });
    }
    expect(existsSync(tmHome)).toBe(false);
  });

  test("without the guard, a repo without timemachine.yml still gets a save point", async () => {
    const { dir, ctx } = repo();
    const r = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" });
    expect(r.checkpoint).toBe("cp-0001");
  });

  test.each(["settings.json", "settings.local.json"])("an initialized repo with tm hook install lines in .claude/%s: the guarded prompt steps aside, the unguarded one saves", async (file) => {
    const { dir, ctx } = repo();
    writeConfig(dir);
    await tm.hookInstall(ctx, { command: "tm" });
    if (file !== "settings.json") {
      const own = join(dir, ".claude", "settings.json");
      writeFileSync(join(dir, ".claude", file), readFileSync(own, "utf8"));
      writeFileSync(own, "{}\n");
    }
    const guardedRun = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, guarded);
    expect(guardedRun).toEqual({ event: "prompt", exitCode: 0, checkpoint: null, verdict: null, message: "" });
    expect((await tm.timeline(ctx)).checkpoints).toEqual([]);
    const own = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" });
    expect(own.checkpoint).toBe("cp-0001");
  });

  test("own hooks for another event do not stop the guarded hook", async () => {
    const { dir, ctx } = repo();
    writeConfig(dir);
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "tm hook stop" }] }] } }));
    expect((await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, guarded)).checkpoint).toBe("cp-0001");
  });

  test("a malformed .claude/settings.json does not block the guarded prompt", async () => {
    const { dir, ctx } = repo();
    writeConfig(dir);
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), "{ // not JSON\n");
    writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify({ hooks: "tm hook prompt" }));
    const r = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, guarded);
    expect(r).toMatchObject({ exitCode: 0, checkpoint: "cp-0001", message: "" });
  });
});
