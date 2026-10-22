// M3: agent hooks (C15), duplicate skipping, and the built-in demo.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

  test("reconnecting replaces obsolete Time Machine hooks without deleting another tool's hooks", async () => {
    const { dir, ctx } = await setupDemo();
    await tm.hookInstall(ctx, { command: "npx -y timetm@0.1.0" });
    const path = join(dir, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(path, "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    settings.hooks.Stop![0]!.hooks.push({ command: "echo mine" });
    writeFileSync(path, JSON.stringify(settings));
    const old = "'/usr/local/bin/node' '/old folder/cli/dist/tm.js'";
    const current = "'/usr/local/bin/node' '/new folder/cli/dist/tm.js'";
    await tm.hookInstall(ctx, { command: old });
    await tm.hookInstall(ctx, { command: current });
    await tm.hookInstall(ctx, { command: current });
    const result = JSON.parse(readFileSync(path, "utf8")) as typeof settings;
    for (const [event, suffix] of [["UserPromptSubmit", "prompt"], ["PreToolUse", "pre-bash"], ["Stop", "stop"]]) {
      const commands = result.hooks[event!]!.flatMap(group => group.hooks.map(hook => hook.command));
      expect(commands.filter(command => command.endsWith(` hook ${suffix}`))).toEqual([`${current} hook ${suffix}`]);
    }
    expect(result.hooks.Stop!.flatMap(group => group.hooks.map(hook => hook.command))).toContain("echo mine");
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

describe("second review fixes", () => {
  test("R1 --if-changed skips even when tracked files have uncommitted edits", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "src/tips.js", "export const edited = 1;\n");
    const a = await tm.checkpoint(ctx, { skipIfUnchanged: true });
    const b = await tm.checkpoint(ctx, { skipIfUnchanged: true });
    expect(a.skipped).toBe(false);
    expect(b.skipped).toBe(true);
    expect(b.checkpoint.id).toBe(a.checkpoint.id);
  });

  test("R2 the stop hook wakes the agent once per breakage, even after find-good", async () => {
    const { dir, ctx } = await setupDemo();
    await tm.verify(ctx, "cp-0003");
    expect((await tm.runHook(ctx, "stop", { cwd: dir })).exitCode).toBe(2);
    await tm.findGood(ctx);
    expect((await tm.runHook(ctx, "stop", { cwd: dir })).exitCode).toBe(0);
  });

  test("R3 a secret in a checkpoint note is never stored", async () => {
    const { ctx } = await setupDemo();
    const r = await tm.checkpoint(ctx, { note: `deploy key ${FAKE_TOKEN}` });
    expect(r.checkpoint.note).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(await tm.timeline(ctx))).not.toContain(FAKE_TOKEN);
  });

  test("R4 tm demo keeps an existing empty folder as it is and refuses a file", async () => {
    const root = tempDir("demo-keep");
    const dir = join(root, "empty");
    mkdirSync(dir, { mode: 0o700 });
    await tm.demo({ cwd: root, tmHome: join(root, "store") }, { dir });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    writeFileSync(join(root, "afile"), "x");
    await expect(tm.demo({ cwd: root, tmHome: join(root, "store") }, { dir: join(root, "afile") })).rejects.toThrow(tm.TmError);
  });

  test("R5 hook install refuses settings it cannot parse with a usage error, and leaves them alone", async () => {
    const { dir, ctx } = await setupDemo();
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude/settings.json"), "// my notes\n{}");
    const err = await tm.hookInstall(ctx, { command: "tm" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(tm.TmError);
    expect((err as tm.TmError).exitCode).toBe(64);
    expect(readFileSync(join(dir, ".claude/settings.json"), "utf8")).toBe("// my notes\n{}");
  });

  test("R6 risky command detection covers common destructive forms", () => {
    const risky = ["rm -R dir", "rm --recursive --force dir", "rm -rf src", "sudo rm -rf x", "git checkout -f", "git checkout HEAD -- src", "git checkout main -- .", "git switch -f main", "git switch --discard-changes main", "git -C . reset --hard", "git -c a=b reset --hard", "git clean --force -d", "git clean -f", "git clean -fd", "git clean -df", "git clean -fdx", "git clean -xfd", "git clean -ffdx", "git clean -d -f src", "git worktree remove --force ../x", "npm test && git reset --hard HEAD~1"];
    const safe = ["ls -la", "git status", "git checkout -b feature", "git switch main", "npm test", "git diff -- src", "git clean -n", "git clean --dry-run", "git clean -nd", "git clean -dnx"];
    for (const c of risky) expect(tm.isRisky(c), c).toBe(true);
    for (const c of safe) expect(tm.isRisky(c), c).toBe(false);
  });
});
