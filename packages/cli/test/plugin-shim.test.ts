// The plugin's hooks and MCP server go through scripts/tm-hook. It runs the tm on PATH only after checking
// that it is Time Machine, so another program named tm never receives a prompt.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { main } from "../src/main.ts";

const PLUGIN = resolve(import.meta.dirname, "../../../plugins/time-machine");
const SHIM = join(PLUGIN, "scripts", "tm-hook");
const input = JSON.stringify({ cwd: "/nowhere", prompt: "secret plans" });

async function helpText(): Promise<string> {
  let out = "";
  await main(["--help"], { cwd: process.cwd(), env: process.env, stdout: (s) => { out += s; }, stderr: () => {}, isTTY: false });
  return out;
}

/** A bin folder with a fake tm that logs its arguments and stdin. `help` is what it prints for --help. */
function fakeTm(help: string): { dir: string; bin: string; tm: string; calls: () => string[]; stdin: () => string } {
  const dir = tempDir("shim");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "help.txt"), help);
  const tm = join(bin, "tm");
  writeFileSync(tm, `#!/bin/sh
printf '%s\\n' "$*" >> '${dir}/args'
if [ "$1" = --help ]; then cat '${dir}/help.txt'; exit 0; fi
cat >> '${dir}/stdin'
if [ "$2" = stop ]; then echo broke >&2; exit 2; fi
exit 0
`);
  chmodSync(tm, 0o755);
  const read = (name: string): string => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "");
  return { dir, bin, tm, calls: () => read("args").split("\n").filter(Boolean), stdin: () => read("stdin") };
}

function shim(env: { bin: string; dir: string }, arg: string): { code: number | null; out: string; err: string } {
  const r = spawnSync("/bin/sh", [SHIM, arg], { input, encoding: "utf8", env: { PATH: `${env.bin}:/usr/bin:/bin`, HOME: env.dir, TM_HOME: join(env.dir, "tmhome") } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("plugin scripts/tm-hook", () => {
  test("a tm that is not Time Machine never gets the hook input, and is asked only once", () => {
    const f = fakeTm("tm: a tiny task manager\n");
    expect(shim(f, "prompt")).toEqual({ code: 0, out: "", err: "" });
    expect(shim(f, "stop")).toEqual({ code: 0, out: "", err: "" });
    expect(f.calls()).toEqual(["--help"]);
    expect(f.stdin()).toBe("");
  });

  test("Time Machine's tm gets the hook with --if-initialized, stdin, and its exit code passes through", async () => {
    const f = fakeTm(await helpText());
    expect(shim(f, "prompt")).toEqual({ code: 0, out: "", err: "" });
    expect(shim(f, "stop")).toEqual({ code: 2, out: "", err: "broke\n" });
    expect(shim(f, "mcp").code).toBe(0);
    expect(f.calls()).toEqual(["--help", "hook prompt --if-initialized", "hook stop --if-initialized", "mcp"]);
    expect(f.stdin()).toBe(input.repeat(3));
  });

  test("a changed tm file is checked again", async () => {
    const f = fakeTm(await helpText());
    shim(f, "prompt");
    writeFileSync(join(f.dir, "help.txt"), "tm: something else now\n");
    const later = statSync(f.tm).mtimeMs / 1000 + 60;
    utimesSync(f.tm, later, later);
    expect(shim(f, "prompt")).toEqual({ code: 0, out: "", err: "" });
    expect(f.calls()).toEqual(["--help", "hook prompt --if-initialized", "--help"]);
  });

  test("no tm on PATH, or an unknown argument: exit 0, no output", () => {
    const f = fakeTm("");
    const empty = { bin: join(f.dir, "nothing"), dir: f.dir };
    expect(shim(empty, "prompt")).toEqual({ code: 0, out: "", err: "" });
    expect(shim(f, "install")).toEqual({ code: 0, out: "", err: "" });
    expect(f.calls()).toEqual([]);
  });

  test("every plugin hook runs the shim for its own event", async () => {
    const Hooks = z.object({ hooks: z.record(z.string(), z.array(z.object({ hooks: z.array(z.object({ command: z.string() })) }))) });
    const hooks = Hooks.parse(JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8"))).hooks;
    const f = fakeTm(await helpText());
    for (const [event, arg] of [["UserPromptSubmit", "prompt"], ["PreToolUse", "pre-bash"], ["Stop", "stop"]] as const) {
      const command = hooks[event]?.[0]?.hooks[0]?.command ?? "";
      expect(command).toBe(`"\${CLAUDE_PLUGIN_ROOT}/scripts/tm-hook" ${arg}`);
      const r = spawnSync("/bin/bash", ["-c", command], { input, encoding: "utf8", env: { PATH: `${f.bin}:/usr/bin:/bin`, HOME: f.dir, TM_HOME: join(f.dir, "tmhome"), CLAUDE_PLUGIN_ROOT: PLUGIN } });
      expect(r.status).toBe(arg === "stop" ? 2 : 0);
    }
    expect(f.calls()).toEqual(["--help", "hook prompt --if-initialized", "hook pre-bash --if-initialized", "hook stop --if-initialized"]);
  });

  test("the MCP server runs through the shim, and the plugin has no top-level bin/ (it would join Claude's Bash PATH)", () => {
    const Mcp = z.object({ mcpServers: z.record(z.string(), z.object({ command: z.string(), args: z.array(z.string()) })) });
    expect(Mcp.parse(JSON.parse(readFileSync(join(PLUGIN, ".mcp.json"), "utf8"))).mcpServers.timemachine).toEqual({ command: "${CLAUDE_PLUGIN_ROOT}/scripts/tm-hook", args: ["mcp"] });
    expect(existsSync(join(PLUGIN, "bin"))).toBe(false);
  });
});
