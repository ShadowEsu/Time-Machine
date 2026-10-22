// `tm hook <event> --if-initialized` is what the Claude Code plugin runs in every folder.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir, writeConfig } from "../../../fixtures/demo/setup.ts";
import { main } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(cwd: string, env: NodeJS.ProcessEnv, argv: string[], stdin = ""): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd, env, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, isTTY: false, stdin: Readable.from([stdin]) });
  return { code, out, err };
}

function folder(withGit: boolean): { dir: string; tmHome: string; env: NodeJS.ProcessEnv } {
  const root = tempDir("cliguard");
  const dir = join(root, "app");
  write(dir, "index.js", "export const a = 1;\n");
  if (withGit) {
    git(root, "init", "-q", "-b", "main", dir);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "first");
  }
  const tmHome = join(root, "store");
  return { dir, tmHome, env: { ...process.env, TM_HOME: tmHome, GIT_CEILING_DIRECTORIES: root } };
}

describe("tm hook --if-initialized", () => {
  test("in a Git repo without timemachine.yml it exits 0, prints nothing, and creates no store", async () => {
    const { dir, tmHome, env } = folder(true);
    for (const event of ["prompt", "stop"]) {
      const r = await run(dir, env, ["hook", event, "--if-initialized"], JSON.stringify({ cwd: dir, prompt: "x" }));
      expect(r).toEqual({ code: 0, out: "", err: "" });
    }
    expect(existsSync(tmHome)).toBe(false);
  });

  test("after tm init a prompt makes a save point", async () => {
    const { dir, env } = folder(true);
    writeConfig(dir);
    const r = await run(dir, env, ["hook", "prompt", "--if-initialized", "--json"], JSON.stringify({ cwd: dir, prompt: "x" }));
    expect(JSON.parse(r.out)).toMatchObject({ event: "prompt", exitCode: 0, checkpoint: "cp-0001" });
    expect(r.code).toBe(0);
  });

  test("outside any Git repo it exits 0 and prints nothing", async () => {
    const { dir, tmHome, env } = folder(false);
    const r = await run(dir, env, ["hook", "prompt", "--if-initialized"], JSON.stringify({ cwd: dir, prompt: "x" }));
    expect(r).toEqual({ code: 0, out: "", err: "" });
    expect(existsSync(tmHome)).toBe(false);
  });

  test("the flag does not apply to hook install or other commands", async () => {
    const { dir, env } = folder(true);
    expect((await run(dir, env, ["hook", "install", "--if-initialized"])).code).toBe(64);
    expect((await run(dir, env, ["timeline", "--if-initialized"])).code).toBe(64);
  });
});
