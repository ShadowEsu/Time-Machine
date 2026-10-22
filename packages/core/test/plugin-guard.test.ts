// The Claude Code plugin runs its hooks in every session in every folder. With requireConfig a hook
// acts only in a project the user opted into with tm init, and is silent everywhere else.
import { existsSync } from "node:fs";
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
});
