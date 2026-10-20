// CLI side of the review fixes: the hook fallback is pinned, and triggers cannot fake an agent.
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { probeHookCommand } from "@timetm/core";
import { setupDemo, tempDir, type Demo } from "../../../fixtures/demo/setup.ts";
import { main, VERSION } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(demo: Demo, env: NodeJS.ProcessEnv, argv: string[], script?: string): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd: demo.dir, env, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, isTTY: false, ...(script !== undefined ? { script } : {}) });
  return { code, out, err };
}

/** An env with no tm on PATH and no override, like a new user who built from source. */
function noTmOnPath(demo: Demo): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...demo.ctx.env, PATH: "/usr/bin:/bin" };
  delete env.TM_HOOK_COMMAND;
  return env;
}

/** A stand-in CLI file that answers --version like tm does. */
function fakeCli(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "tm.js");
  writeFileSync(file, `if (process.argv[2] === "--version") process.stdout.write(${JSON.stringify(`${VERSION}\n`)});\n`);
  return file;
}

const settingsOf = (demo: Demo): string => readFileSync(join(demo.dir, ".claude", "settings.json"), "utf8");
const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

describe("CLI review fixes", () => {

  test("without a matching tm on PATH, the hooks call this CLI by its absolute path, not npx", async () => {
    const demo = await setupDemo();
    const script = fakeCli(join(tempDir("cli"), "packages", "cli", "dist"));
    const r = await run(demo, noTmOnPath(demo), ["hook", "install"], script);
    expect(r.code).toBe(0);
    const command = `${quote(process.execPath)} ${quote(realpathSync(script))}`;
    expect(settingsOf(demo)).toContain(JSON.stringify(`${command} hook prompt`));
    expect(settingsOf(demo)).not.toMatch(/npx/);
  });

  test("run from the npx cache, the hooks call a version-pinned npx command", async () => {
    const demo = await setupDemo();
    const script = fakeCli(join(tempDir("npm"), "_npx", "0123abcd", "node_modules", "timetm", "dist"));
    const r = await run(demo, noTmOnPath(demo), ["hook", "install"], script);
    expect(r.code).toBe(0);
    expect(settingsOf(demo)).toContain(`npx -y timetm@${VERSION} hook prompt`);
    expect(settingsOf(demo)).not.toMatch(/npx -y timetm hook/);
  });

  test("a linked CLI in a folder with a space and a quote is resolved, quoted, and runs in a shell", async () => {
    const demo = await setupDemo();
    const root = tempDir("quote");
    const real = fakeCli(join(root, "it's my tm", "dist"));
    mkdirSync(join(root, "bin"));
    symlinkSync(real, join(root, "bin", "tm"));
    const r = await run(demo, noTmOnPath(demo), ["hook", "install", "--json"], join(root, "bin", "tm"));
    expect(r.code).toBe(0);
    const { command } = JSON.parse(r.out) as { command: string };
    expect(command).toBe(`${quote(process.execPath)} ${quote(realpathSync(real))}`);
    expect(settingsOf(demo)).toContain(JSON.stringify(`${command} hook stop`));
    // The same probe hook status and the desktop app use: `<command> --version` through /bin/sh.
    expect(await probeHookCommand(command, VERSION, demo.dir, noTmOnPath(demo))).toBe(true);
  });

  test("--trigger claude-code is refused, so the CLI cannot pose as the hooks", async () => {
    const demo = await setupDemo();
    const r = await run(demo, demo.ctx.env ?? {}, ["checkpoint", "--trigger", "claude-code:stop"]);
    expect(r.code).toBe(64);
    expect(r.err).toMatch(/claude-code/);
  });
});
