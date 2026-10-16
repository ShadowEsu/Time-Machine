// Engine support for the Mac app's menu bar and Settings (D06, D07): the agent turn signal,
// Claude Code connection status, and cleaning up the store without touching save points.
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { write } from "../../../fixtures/demo/build.ts";
import { setupDemo } from "../../../fixtures/demo/setup.ts";

describe("agent turn signal", () => {
  test("the prompt hook records a turn start and the stop hook records its end", async () => {
    const { dir, ctx } = await setupDemo();
    await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "add a footer" });
    let turns = (await tm.log(ctx)).entries.filter((e) => e.action === "agent-turn");
    expect(turns.map((e) => e.result)).toEqual(["started"]);
    write(dir, "draft.txt", "x\n");
    await tm.runHook(ctx, "stop", { cwd: dir });
    turns = (await tm.log(ctx)).entries.filter((e) => e.action === "agent-turn");
    expect(turns.map((e) => e.result)).toEqual(["started", "ended"]);
  });

  test("the start is recorded even when nothing changed and no save point is made", async () => {
    const { dir, ctx } = await setupDemo();
    const r = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "look around" });
    expect(r.checkpoint).toBeNull();
    const turns = (await tm.log(ctx)).entries.filter((e) => e.action === "agent-turn");
    expect(turns).toHaveLength(1);
  });
});

describe("Claude Code connection status", () => {
  test("reports missing lines before install and none after", async () => {
    const { dir, ctx } = await setupDemo();
    const before = await tm.hookStatus(ctx, { command: "tm", version: "0.1.0" });
    expect(before.settingsPath).toBe(join(realpathSync(dir), ".claude", "settings.json"));
    expect(before.readable).toBe(true);
    expect(before.present).toEqual([]);
    expect(before.missing).toEqual(["UserPromptSubmit", "PreToolUse", "Stop"]);
    await tm.hookInstall(ctx, { command: "tm" });
    const after = await tm.hookStatus(ctx, { command: "tm", version: "0.1.0" });
    expect(after.present).toEqual(["UserPromptSubmit", "PreToolUse", "Stop"]);
    expect(after.missing).toEqual([]);
  });

  test("lines for another command do not count, and an unreadable file is reported, not changed", async () => {
    const { dir, ctx } = await setupDemo();
    await tm.hookInstall(ctx, { command: "npx -y timetm" });
    expect((await tm.hookStatus(ctx, { command: "tm", version: "0.1.0" })).present).toEqual([]);
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude/settings.json"), "{ // a comment\n}");
    const s = await tm.hookStatus(ctx, { command: "tm", version: "0.1.0" });
    expect(s.readable).toBe(false);
    expect(s.present).toEqual([]);
  });
});

describe("store cleanup", () => {
  test("removes only check logs that a newer check replaced, and never save points", async () => {
    const { ctx } = await setupDemo();
    const first = await tm.verify(ctx, "cp-0003");
    const second = await tm.verify(ctx, "cp-0003");
    const other = await tm.verify(ctx, "cp-0006");
    const store = tm.storeDirFor(ctx);
    const logs = (): string[] => readdirSync(join(store, "logs")).sort();
    const checkpoints = readdirSync(join(store, "checkpoints")).sort();
    expect(first.log && second.log && other.log).toBeTruthy();
    expect(logs()).toHaveLength(3);

    const preview = await tm.cleanStore(ctx, { apply: false });
    expect(preview.applied).toBe(false);
    expect(preview.files).toEqual([`logs/${first.log?.split("/").at(-1)}`]);
    expect(preview.bytes).toBeGreaterThan(0);
    expect(logs()).toHaveLength(3);

    const done = await tm.cleanStore(ctx, { apply: true, files: preview.files });
    expect(done.applied).toBe(true);
    expect(done.files).toEqual(preview.files);
    expect(existsSync(first.log ?? "")).toBe(false);
    expect(existsSync(second.log ?? "")).toBe(true);
    expect(existsSync(other.log ?? "")).toBe(true);
    expect(readdirSync(join(store, "checkpoints")).sort()).toEqual(checkpoints);
    expect((await tm.timeline(ctx)).checkpoints.find((c) => c.id === "cp-0003")?.verdict).toBe(second.verdict);
    expect((await tm.log(ctx)).entries.at(-1)).toMatchObject({ action: "clean", result: "removed 1 old check log" });

    const again = await tm.cleanStore(ctx, { apply: true, files: preview.files });
    expect(again.files).toEqual([]);
    expect(again.bytes).toBe(0);
  });

  test("a project with no store yet has nothing to clean", async () => {
    const { ctx } = await setupDemo();
    const r = await tm.cleanStore({ ...ctx, tmHome: join(ctx.tmHome ?? "", "elsewhere") }, { apply: true, files: [] });
    expect(r).toEqual({ files: [], bytes: 0, applied: true });
  });
});
