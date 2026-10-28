// tm forget takes back what tm init and tm hook install agreed to on this computer (consent rule 6, Security T5):
// after it, the plugin's guarded hooks and the check tools step aside, our hook lines are gone, other tools' hooks and
// the save points stay.
import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir, writeConfig } from "../../../fixtures/demo/setup.ts";
import { writeSettings } from "../src/hooks.ts";

function repo(): { dir: string; tmHome: string; ctx: tm.Ctx } {
  // The real path: on macOS the temp folder is /var/… while tm reports /private/var/… (the folder's real path).
  const root = realpathSync(tempDir("forget"));
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

describe("a .claude/settings.json that is a link (Security INFO)", () => {
  // A cloned repo can ship .claude/settings.json, or .claude itself, as a link to a file outside the project.
  function linked(how: "file" | "folder"): { dir: string; ctx: tm.Ctx; target: string; original: string } {
    const { dir, ctx } = repo();
    const outside = join(dir, "..", "outside");
    mkdirSync(outside, { recursive: true });
    const target = join(outside, "settings.json");
    const original = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"tm hook stop"}]}]}}\n';
    writeFileSync(target, original);
    if (how === "file") {
      mkdirSync(join(dir, ".claude"));
      symlinkSync(target, join(dir, ".claude", "settings.json"));
    } else symlinkSync(outside, join(dir, ".claude"));
    return { dir, ctx, target, original };
  }

  test.each(["file", "folder"] as const)("linked %s: tm hook install refuses and the file it points to is unchanged", async (how) => {
    const { dir, ctx, target, original } = linked(how);
    writeConfig(dir);
    await tm.init(ctx);
    await expect(tm.hookInstall(ctx, { command: "tm" })).rejects.toThrow(/is a link to somewhere else, so it was left alone/);
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  test.each(["file", "folder"] as const)("linked %s: tm forget leaves it alone, names it, and still takes back the approval", async (how) => {
    const { dir, ctx, target, original } = linked(how);
    writeConfig(dir);
    await tm.init(ctx);
    const r = tm.forget(ctx);
    expect(r).toMatchObject({ approvalRemoved: true, hooksRemoved: [], unreadable: [join(dir, ".claude", "settings.json")] });
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  test("a settings.json hard linked to another file is left alone too", async () => {
    const { dir, ctx } = repo();
    const outside = join(dir, "..", "shared.json");
    writeFileSync(outside, "{}\n");
    mkdirSync(join(dir, ".claude"));
    linkSync(outside, join(dir, ".claude", "settings.json"));
    writeConfig(dir);
    await tm.init(ctx);
    await expect(tm.hookInstall(ctx, { command: "tm" })).rejects.toThrow(/is a link to somewhere else/);
    expect(tm.forget(ctx).unreadable).toEqual([join(dir, ".claude", "settings.json")]);
    expect(readFileSync(outside, "utf8")).toBe("{}\n");
  });

  test("the write itself refuses a link that appears after the check (O_NOFOLLOW)", () => {
    const { dir } = repo();
    const target = join(dir, "..", "target.txt");
    writeFileSync(target, "keep\n");
    const path = join(dir, "settings.json");
    symlinkSync(target, path);
    expect(() => writeSettings(path, "{}\n")).toThrow(expect.objectContaining({ code: "ELOOP" }));
    expect(readFileSync(target, "utf8")).toBe("keep\n");
  });
});
