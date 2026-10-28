// tm forget takes back what tm init and tm hook install agreed to on this computer (consent rule 6, Security T5):
// after it, the plugin's guarded hooks and the check tools step aside, our hook lines are gone, other tools' hooks and
// the save points stay.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir, writeConfig } from "../../../fixtures/demo/setup.ts";

function repo(): { dir: string; tmHome: string; ctx: tm.Ctx } {
  const root = tempDir("forget");
  const dir = join(root, "app");
  write(dir, "index.js", "export const a = 1;\n");
  git(root, "init", "-q", "-b", "main", dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  const tmHome = join(root, "store");
  return { dir, tmHome, ctx: { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } } };
}

const OTHER = { type: "command", command: "other-tool lint" };

describe("tm forget", () => {
  test("removes the approval and only our hook lines; other hooks, other settings and save points stay; hooks then act nowhere", async () => {
    const { dir, ctx } = repo();
    writeConfig(dir);
    await tm.init(ctx);
    await tm.hookInstall(ctx, { command: "tm" });
    const path = join(dir, ".claude", "settings.json");
    const installed = JSON.parse(readFileSync(path, "utf8")) as { hooks: Record<string, { matcher?: string; hooks: unknown[] }[]> };
    installed.hooks.Stop?.[0]?.hooks.push(OTHER);
    writeFileSync(path, JSON.stringify({ model: "kept", ...installed }, null, 2));
    // While tm hook install's lines are there, they save (the plugin steps aside for them).
    const saved = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" });
    expect(saved.checkpoint).toBe("cp-0001");

    const r = tm.forget(ctx);

    expect(r.approvalRemoved).toBe(true);
    expect(r.hooksRemoved).toEqual([{ path, removed: ["UserPromptSubmit", "PreToolUse", "Stop"] }]);
    expect(r.unreadable).toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ model: "kept", hooks: { Stop: [{ hooks: [OTHER] }] } });
    expect(tm.status(ctx)).toMatchObject({ initialized: true, approved: false });
    // The plugin's guarded hook makes nothing now.
    expect(await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "y" }, { requireConfig: true })).toEqual({ event: "prompt", exitCode: 0, checkpoint: null, verdict: null, message: "" });
    // Save points stay until the person deletes the store.
    expect(existsSync(r.store)).toBe(true);
    expect((await tm.timeline(ctx)).checkpoints.map((c) => c.id)).toEqual(["cp-0001"]);
    // tm init sets it up again.
    await tm.init(ctx);
    expect(tm.status(ctx).approved).toBe(true);
  });

  test("a settings file that is not plain JSON is left alone and named, and the approval is still removed", async () => {
    const { dir, ctx } = repo();
    writeConfig(dir);
    await tm.init(ctx);
    await tm.hookInstall(ctx, { command: "tm" });
    const path = join(dir, ".claude", "settings.json");
    const withComment = `// mine\n${readFileSync(path, "utf8")}`;
    writeFileSync(path, withComment);
    const r = tm.forget(ctx);
    expect(r).toMatchObject({ approvalRemoved: true, hooksRemoved: [], unreadable: [path] });
    expect(readFileSync(path, "utf8")).toBe(withComment);
  });

  test("a project never set up: nothing to take back, and no store is created", () => {
    const { tmHome, ctx } = repo();
    expect(tm.forget(ctx)).toMatchObject({ approvalRemoved: false, hooksRemoved: [], unreadable: [] });
    expect(existsSync(tmHome)).toBe(false);
  });
});
