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

  test("a timemachine.yml alone is not consent; after tm init a prompt makes a save point", async () => {
    const { dir, env } = folder(true);
    writeConfig(dir);
    const input = JSON.stringify({ cwd: dir, prompt: "x" });
    expect(await run(dir, env, ["hook", "prompt", "--if-initialized"], input)).toEqual({ code: 0, out: "", err: "" });
    const init = await run(dir, env, ["init"]);
    expect(init.code).toBe(0);
    expect(init.out).toContain("Approved  node --test");
    const r = await run(dir, env, ["hook", "prompt", "--if-initialized", "--json"], input);
    expect(JSON.parse(r.out)).toMatchObject({ event: "prompt", exitCode: 0, checkpoint: "cp-0001" });
    expect(r.code).toBe(0);
  });

  test("tm init --no-approve writes the file, records no consent, and says how to approve", async () => {
    const { dir, env } = folder(true);
    // An empty check is never approved, so this project needs a test script for init to guess.
    write(dir, "package.json", JSON.stringify({ name: "app", scripts: { test: "node --test" } }));
    const input = JSON.stringify({ cwd: dir, prompt: "x" });
    const r = await run(dir, env, ["init", "--no-approve"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Created ");
    expect(r.out).toContain("Approval  not recorded. When the check above is right, run tm init");
    expect(r.out).not.toContain("Approved  ");
    expect(JSON.parse((await run(dir, env, ["init", "--no-approve", "--json"])).out)).toMatchObject({ created: false, approvedCheck: null });
    expect(await run(dir, env, ["hook", "prompt", "--if-initialized"], input)).toEqual({ code: 0, out: "", err: "" });
    expect((await run(dir, env, ["init"])).out).toContain("Approved  ");
    expect(JSON.parse((await run(dir, env, ["hook", "prompt", "--if-initialized", "--json"], input)).out)).toMatchObject({ checkpoint: "cp-0001" });
    expect((await run(dir, env, ["timeline", "--no-approve"])).code).toBe(64);
  });

  test("a check changed after tm init: the prompt hook tells the user once with systemMessage JSON, stop stays silent", async () => {
    const { dir, env } = folder(true);
    writeConfig(dir);
    await run(dir, env, ["init"]);
    writeConfig(dir, { command: "npm test" });
    const input = JSON.stringify({ cwd: dir, prompt: "x" });
    const silent = { code: 0, out: "", err: "" };
    expect(await run(dir, env, ["hook", "stop", "--if-initialized"], input)).toEqual(silent);
    expect(await run(dir, env, ["hook", "prompt", "--if-initialized"], input)).toEqual({ code: 0, out: '{"systemMessage":"Time Machine: the check in timemachine.yml changed; run tm init to approve it."}\n', err: "" });
    expect(await run(dir, env, ["hook", "prompt", "--if-initialized"], input)).toEqual(silent);
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
