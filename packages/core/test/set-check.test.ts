// setCheck: the app's onboarding step 2 changes the check. The engine owns timemachine.yml.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";

function repo(): { dir: string; ctx: tm.Ctx } {
  const root = tempDir("setcheck");
  const dir = join(root, "app");
  write(dir, "package.json", JSON.stringify({ name: "app", scripts: { test: "node --test", build: "node build.js" } }) + "\n");
  git(root, "init", "-q", "-b", "main", dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  const tmHome = join(root, "store");
  return { dir, ctx: { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } } };
}

describe("setCheck", () => {
  test("changes verify.command, keeps the comments, and records it in the audit log", async () => {
    const { dir, ctx } = repo();
    const first = await tm.init(ctx);
    expect(first.verifyCommand).toBe("npm test");
    const r = await tm.setCheck(ctx, "npm run build");
    expect(r.verifyCommand).toBe("npm run build");
    const text = readFileSync(join(dir, "timemachine.yml"), "utf8");
    expect(text).toContain(`command: "npm run build"`);
    expect(text).toContain("# The check that decides if a save point works.");
    expect((await tm.init(ctx)).verifyCommand).toBe("npm run build");
    const actions = (await tm.log(ctx)).entries.map((e) => e.action);
    expect(actions).toContain("set-check");
    // The command itself is never written to the audit log, only that it changed.
    expect(JSON.stringify((await tm.log(ctx)).entries)).not.toContain("npm run build");
  });

  test("rejects an empty command or one with a line break, and leaves the file alone", async () => {
    const { dir, ctx } = repo();
    await tm.init(ctx);
    const before = readFileSync(join(dir, "timemachine.yml"), "utf8");
    await expect(tm.setCheck(ctx, "  ")).rejects.toThrow(tm.TmError);
    await expect(tm.setCheck(ctx, "npm test\nrm -rf /")).rejects.toThrow(tm.TmError);
    expect(readFileSync(join(dir, "timemachine.yml"), "utf8")).toBe(before);
  });

  test("asks for init first when there is no timemachine.yml", async () => {
    const { ctx } = repo();
    await expect(tm.setCheck(ctx, "npm test")).rejects.toThrow(/tm init/);
  });
});
