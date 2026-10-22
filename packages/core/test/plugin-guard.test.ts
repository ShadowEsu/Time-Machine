// The Claude Code plugin runs its hooks in every session in every folder. With requireConfig a hook
// acts only in a project the user approved with tm init on this computer, and is silent everywhere else.
import { createHash } from "node:crypto";
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

  test("a guarded prompt in a repo approved with tm init makes a save point", async () => {
    const { dir, ctx } = repo();
    writeConfig(dir);
    await tm.init(ctx);
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
    await tm.init(ctx);
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
    await tm.init(ctx);
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "tm hook stop" }] }] } }));
    expect((await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, guarded)).checkpoint).toBe("cp-0001");
  });

  test("a malformed .claude/settings.json does not block the guarded prompt", async () => {
    const { dir, ctx } = repo();
    writeConfig(dir);
    await tm.init(ctx);
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), "{ // not JSON\n");
    writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify({ hooks: "tm hook prompt" }));
    const r = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, guarded);
    expect(r).toMatchObject({ exitCode: 0, checkpoint: "cp-0001", message: "" });
  });
});

const CHANGED = "Time Machine: the check in timemachine.yml changed; run tm init to approve it.";

/** A repo whose check writes a marker file, so a test can tell whether the check ran. */
function markerRepo(): { dir: string; tmHome: string; ctx: tm.Ctx; marker: string; setCheck: (word: string) => string } {
  const r = repo();
  const marker = join(r.dir, "..", "marker");
  const setCheck = (word: string): string => {
    const command = `echo ${word} > ${marker}`;
    writeConfig(r.dir, { command });
    return command;
  };
  setCheck("ran");
  return { ...r, marker, setCheck };
}
const ran = (marker: string): string | null => (existsSync(marker) ? readFileSync(marker, "utf8").trim() : null);
const bash = { tool_input: { command: "rm -rf build" } };

describe("plugin hooks need consent pinned to the check", () => {
  test("a timemachine.yml the user never approved: no hook saves, the check never runs, no store is made", async () => {
    const { dir, tmHome, ctx, marker } = markerRepo();
    for (const event of ["prompt", "pre-bash", "stop"] as const) {
      const r = await tm.runHook(ctx, event, { cwd: dir, prompt: "x", ...bash }, guarded);
      expect(r).toEqual({ event, exitCode: 0, checkpoint: null, verdict: null, message: "" });
    }
    expect(ran(marker)).toBeNull();
    expect(existsSync(tmHome)).toBe(false);
  });

  test("after tm init, prompt and pre-bash save and stop runs the check", async () => {
    const { dir, ctx, marker } = markerRepo();
    await tm.init(ctx);
    expect((await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, guarded)).checkpoint).toBe("cp-0001");
    write(dir, "index.js", "export const a = 2;\n");
    expect((await tm.runHook(ctx, "pre-bash", { cwd: dir, ...bash }, guarded)).checkpoint).toBe("cp-0002");
    const stop = await tm.runHook(ctx, "stop", { cwd: dir }, guarded);
    expect(stop).toMatchObject({ exitCode: 0, checkpoint: "cp-0002", verdict: "PASS" });
    expect(ran(marker)).toBe("ran");
  });

  test("a check changed after consent runs nothing, tells the user once on a prompt, and runs again after tm init", async () => {
    const { dir, ctx, marker, setCheck } = markerRepo();
    await tm.init(ctx);
    const changed = setCheck("changed");
    for (const event of ["stop", "pre-bash"] as const) {
      expect(await tm.runHook(ctx, event, { cwd: dir, ...bash }, guarded)).toEqual({ event, exitCode: 0, checkpoint: null, verdict: null, message: "" });
    }
    const first = await tm.runHook(ctx, "prompt", { cwd: dir, prompt: "x" }, guarded);
    expect(first).toEqual({ event: "prompt", exitCode: 0, checkpoint: null, verdict: null, message: "", systemMessage: CHANGED });
    for (const event of ["prompt", "pre-bash", "stop"] as const) {
      expect(await tm.runHook(ctx, event, { cwd: dir, prompt: "x", ...bash }, guarded)).toEqual({ event, exitCode: 0, checkpoint: null, verdict: null, message: "" });
    }
    expect(ran(marker)).toBeNull();
    expect((await tm.timeline(ctx)).checkpoints).toEqual([]);
    expect((await tm.init(ctx)).approvedCheck).toBe(changed);
    expect(await tm.runHook(ctx, "stop", { cwd: dir }, guarded)).toMatchObject({ verdict: "PASS", message: "" });
    expect(ran(marker)).toBe("changed");
  });

  test("tm init on an existing timemachine.yml keeps it byte for byte and records consent outside the repo", async () => {
    const { dir, ctx } = repo();
    writeConfig(dir, { setup: "true", command: "node --test" });
    writeFileSync(join(dir, "timemachine.yml"), `# my own notes\n${readFileSync(join(dir, "timemachine.yml"), "utf8")}`);
    const before = readFileSync(join(dir, "timemachine.yml"), "utf8");
    const r = await tm.init(ctx);
    expect(r).toMatchObject({ created: false, approvedCheck: "true && node --test" });
    expect(readFileSync(join(dir, "timemachine.yml"), "utf8")).toBe(before);
    const consent: unknown = JSON.parse(readFileSync(join(tm.storeDirFor(ctx), "consent.json"), "utf8"));
    expect(consent).toEqual({ verifyHash: createHash("sha256").update("true\0node --test").digest("hex"), at: expect.any(String) });
  });

  test("setting the check from the app approves the check it writes", async () => {
    const { dir, ctx, marker } = markerRepo();
    await tm.init(ctx);
    await tm.setCheck(ctx, `echo set > ${marker}`);
    expect(await tm.runHook(ctx, "stop", { cwd: dir }, guarded)).toMatchObject({ verdict: "PASS", message: "" });
    expect(ran(marker)).toBe("set");
  });
});
