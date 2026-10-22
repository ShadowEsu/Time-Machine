// Whether the Time Machine Claude Code plugin covers a project: installed for it (user scope, or
// project/local scope for this folder) and not turned off by enabledPlugins. The records are the
// ones `claude plugin install` writes (checked against Claude Code on 22 Oct 2026).
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { setupDemo } from "../../../fixtures/demo/setup.ts";

const ID = "time-machine@time-machine";

async function withHome() {
  const demo = await setupDemo();
  const home = mkdtempSync(join(tmpdir(), "tm-claude-home-"));
  const ctx = { ...demo.ctx, env: { ...demo.ctx.env, HOME: home, CLAUDE_CODE_PLUGIN_CACHE_DIR: undefined } };
  return { ...demo, home, ctx, root: realpathSync(demo.dir) };
}

function json(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function install(home: string, entries: Record<string, unknown>[], dir = join(home, ".claude", "plugins")): void {
  json(join(dir, "installed_plugins.json"), {
    version: 2,
    plugins: { [ID]: entries.map((e) => ({ installPath: join(dir, "cache/time-machine/time-machine/0.1.0"), version: "0.1.0", ...e })) },
  });
}

describe("Claude Code plugin status", () => {
  test("not installed when Claude Code has no install record", async () => {
    const { ctx } = await withHome();
    expect(tm.claudePluginStatus(ctx)).toEqual({ installed: false, enabled: false, scope: null, version: null });
  });

  test("a user-scope install covers every project and is on by default", async () => {
    const { ctx, home } = await withHome();
    install(home, [{ scope: "user" }]);
    expect(tm.claudePluginStatus(ctx)).toEqual({ installed: true, enabled: true, scope: "user", version: "0.1.0" });
  });

  test("a project-scope install covers only its own folder", async () => {
    const { ctx, home, root } = await withHome();
    install(home, [{ scope: "project", projectPath: join(tmpdir(), "some-other-project") }]);
    expect(tm.claudePluginStatus(ctx).installed).toBe(false);
    install(home, [{ scope: "project", projectPath: root }]);
    expect(tm.claudePluginStatus(ctx)).toMatchObject({ installed: true, enabled: true, scope: "project" });
  });

  test("enabledPlugins decides: local over project over user", async () => {
    const { ctx, home, root } = await withHome();
    install(home, [{ scope: "user" }]);
    const user = join(home, ".claude", "settings.json");
    const project = join(root, ".claude", "settings.json");
    const local = join(root, ".claude", "settings.local.json");
    json(user, { enabledPlugins: { [ID]: false } });
    expect(tm.claudePluginStatus(ctx)).toMatchObject({ installed: true, enabled: false });
    json(project, { enabledPlugins: { [ID]: true } });
    expect(tm.claudePluginStatus(ctx).enabled).toBe(true);
    json(local, { enabledPlugins: { [ID]: false } });
    expect(tm.claudePluginStatus(ctx).enabled).toBe(false);
  });

  test("follows CLAUDE_CODE_PLUGIN_CACHE_DIR, and an unreadable record means not installed", async () => {
    const { ctx, home } = await withHome();
    const moved = join(home, "elsewhere");
    install(home, [{ scope: "user" }], moved);
    expect(tm.claudePluginStatus(ctx).installed).toBe(false);
    const env = { ...ctx.env, CLAUDE_CODE_PLUGIN_CACHE_DIR: moved };
    expect(tm.claudePluginStatus({ ...ctx, env }).installed).toBe(true);
    writeFileSync(join(moved, "installed_plugins.json"), "{ not json");
    expect(tm.claudePluginStatus({ ...ctx, env })).toEqual({ installed: false, enabled: false, scope: null, version: null });
  });
});
