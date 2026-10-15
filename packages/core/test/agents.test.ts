// M3: agent hooks (C15), duplicate skipping, and the built-in demo.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { FAKE_TOKEN, write } from "../../../fixtures/demo/build.ts";
import { setupDemo, tempDir } from "../../../fixtures/demo/setup.ts";

describe("duplicate save points", () => {
  test("skipIfUnchanged reuses the newest checkpoint until something changes", async () => {
    const { dir, ctx } = await setupDemo();
    const same = await tm.checkpoint(ctx, { skipIfUnchanged: true });
    expect(same.skipped).toBe(true);
    expect(same.checkpoint.id).toBe("cp-0006");
    write(dir, "src/tips.js", "export const changed = 1;\n");
    const next = await tm.checkpoint(ctx, { skipIfUnchanged: true });
    expect(next.skipped).toBe(false);
    expect(next.checkpoint.id).toBe("cp-0007");
  });
});

describe("C15 Claude Code hooks", () => {
  test("install merges into existing settings and is idempotent", async () => {
    const { dir, ctx } = await setupDemo();
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const mine = { permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } };
    writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify(mine));
    await tm.hookInstall(ctx, { command: "tm" });
    await tm.hookInstall(ctx, { command: "tm" });
    const s = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8")) as { permissions: unknown; hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(s.permissions).toEqual(mine.permissions);
    const commands = Object.values(s.hooks).flat().flatMap((g) => g.hooks.map((h) => h.command));
    expect(commands).toContain("echo mine");
    expect(commands.filter((c) => c === "tm hook stop")).toHaveLength(1);
    expect(commands).toContain("tm hook prompt");
    expect(commands).toContain("tm hook pre-bash");
  });

  test("a risky shell command gets a save point first, a safe one does not", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "draft.txt", "unsaved work\n");
    const risky = await tm.runHook(ctx, "pre-bash", { cwd: dir, tool_input: { command: "rm -rf src" } });
    expect(risky.exitCode).toBe(0);
    expect(risky.checkpoint).toBe("cp-0007");
    const safe = await tm.runHook(ctx, "pre-bash", { cwd: dir, tool_input: { command: "ls -la" } });
    expect(safe.checkpoint).toBeNull();
  });

  test("the prompt hook never stores secret looking prompt text", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "draft.txt", "x\n");
    const r = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: `use this key ${FAKE_TOKEN} please` });
    const t = await tm.timeline(ctx);
    expect(r.checkpoint).toBe("cp-0007");
    expect(JSON.stringify(t)).not.toContain(FAKE_TOKEN);
  });

  test("stop flags PASS turning into FAIL once, and never loops", async () => {
    const { dir, ctx } = await setupDemo();
    expect((await tm.verify(ctx, "cp-0003")).verdict).toBe("PASS");
    const r = await tm.runHook(ctx, "stop", { cwd: dir, stop_hook_active: false });
    expect(r.exitCode).toBe(2);
    expect(r.message).toContain("cp-0003");
    const again = await tm.runHook(ctx, "stop", { cwd: dir, stop_hook_active: true });
    expect(again.exitCode).toBe(0);
  });

  test("hooks never break the agent: bad input exits 0", async () => {
    const dir = tempDir("nogit");
    const r = await tm.runHook({ cwd: dir }, "pre-bash", { cwd: dir, tool_input: { command: "rm -rf /tmp/x" } });
    expect(r.exitCode).toBe(0);
  });
});

describe("tm demo", () => {
  test("builds the broken project and recovers the newest working version", async () => {
    const root = tempDir("builtin-demo");
    const r = await tm.demo({ cwd: root, tmHome: join(root, "store") }, { dir: join(root, "marigold") });
    expect(r.findGood.found).toBe("cp-0003");
    expect(r.recover.branch).toBe("tm/recover/cp-0003");
    expect(existsSync(join(r.recover.copyDir, "data/themes.json"))).toBe(true);
  });
});
