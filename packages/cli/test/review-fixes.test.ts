// CLI side of the review fixes: the hook fallback is pinned, and triggers cannot fake an agent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { setupDemo, type Demo } from "../../../fixtures/demo/setup.ts";
import { main, VERSION } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(demo: Demo, env: NodeJS.ProcessEnv, ...argv: string[]): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd: demo.dir, env, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, isTTY: false });
  return { code, out, err };
}

describe("CLI review fixes", () => {
  test("VERSION is the CLI package version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  test("without a matching tm on PATH, the hooks call a version-pinned npx command", async () => {
    const demo = await setupDemo();
    const env: NodeJS.ProcessEnv = { ...demo.ctx.env, PATH: "/usr/bin:/bin" };
    delete env.TM_HOOK_COMMAND;
    const r = await run(demo, env, "hook", "install");
    expect(r.code).toBe(0);
    const settings = readFileSync(join(demo.dir, ".claude", "settings.json"), "utf8");
    expect(settings).toContain(`npx -y timetm@${VERSION} hook prompt`);
    expect(settings).not.toMatch(/npx -y timetm hook/);
  });

  test("--trigger claude-code is refused, so the CLI cannot pose as the hooks", async () => {
    const demo = await setupDemo();
    const r = await run(demo, demo.ctx.env ?? {}, "checkpoint", "--trigger", "claude-code:stop");
    expect(r.code).toBe(64);
    expect(r.err).toMatch(/claude-code/);
  });
});
