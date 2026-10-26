// First-run signals in the CLI: the hook JSON Claude Code shows the user, the demo's next step,
// init without a test command, and tm status for the setup skill.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { main } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(cwd: string, env: NodeJS.ProcessEnv, argv: string[], stdin = ""): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd, env, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, isTTY: false, stdin: Readable.from([stdin]) });
  return { code, out, err };
}

function project(scripts: Record<string, string>): { root: string; dir: string; tmHome: string; env: NodeJS.ProcessEnv } {
  const root = tempDir("cliactivation");
  const dir = join(root, "app");
  write(dir, "package.json", JSON.stringify({ name: "app", scripts }));
  write(dir, "index.js", "export const a = 1;\n");
  git(root, "init", "-q", "-b", "main", dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  const tmHome = join(root, "store");
  return { root, dir, tmHome, env: { ...process.env, TM_HOME: tmHome, GIT_CEILING_DIRECTORIES: root } };
}

const withTests = { test: "node --test" };
const silent = { code: 0, out: "", err: "" };
const bash = (dir: string, command: string): string => JSON.stringify({ cwd: dir, tool_name: "Bash", tool_input: { command } });

describe("tm hook pre-bash shows the save point to the user", () => {
  test("the tm hook install route prints exactly one systemMessage JSON object, only for a new save point", async () => {
    const { dir, env } = project(withTests);
    const r = await run(dir, env, ["hook", "pre-bash"], bash(dir, "git reset --hard"));
    expect(r).toEqual({ code: 0, out: '{"systemMessage":"Time Machine saved cp-0001 before git reset --hard."}\n', err: "" });
    // Nothing changed since cp-0001, so no save point and nothing to show.
    expect(await run(dir, env, ["hook", "pre-bash"], bash(dir, "git reset --hard"))).toEqual(silent);
    write(dir, "index.js", "export const a = 2;\n");
    expect(await run(dir, env, ["hook", "pre-bash"], bash(dir, "npm test"))).toEqual(silent);
  });

  test("the plugin route prints nothing before tm init and the same line after", async () => {
    const { dir, tmHome, env } = project(withTests);
    expect(await run(dir, env, ["hook", "pre-bash", "--if-initialized"], bash(dir, "rm -rf dist"))).toEqual(silent);
    expect(existsSync(tmHome)).toBe(false);
    expect((await run(dir, env, ["init"])).code).toBe(0);
    expect(await run(dir, env, ["hook", "pre-bash", "--if-initialized"], bash(dir, "rm -rf dist"))).toEqual({ code: 0, out: '{"systemMessage":"Time Machine saved cp-0001 before rm -rf dist."}\n', err: "" });
    write(dir, "index.js", "export const a = 2;\n");
    expect(await run(dir, env, ["hook", "prompt", "--if-initialized"], JSON.stringify({ cwd: dir, prompt: "x" }))).toEqual(silent);
  });
});

describe("tm init without a test command", () => {
  test("says plainly that save points cannot be checked yet, and how to fix it", async () => {
    const { dir, env } = project({ start: "node index.js" });
    const message = "No test command found, so save points can't be checked yet. Set verify.command in timemachine.yml, then run tm init again to approve it.";
    const r = await run(dir, env, ["init"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(message);
    expect(r.out).not.toContain("Approved");
    const again = await run(dir, env, ["init", "--no-approve"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain(message);
    expect(JSON.parse((await run(dir, env, ["init", "--json"])).out)).toMatchObject({ verifyCommand: "", approvedCheck: null });
    expect(JSON.parse((await run(dir, env, ["status", "--json"])).out)).toEqual({ initialized: true, approved: false, check: null, kind: "git", configPath: expect.stringMatching(/timemachine\.yml$/) });
  });
});

describe("tm status", () => {
  test("--json reports initialized, approved and check without making a store", async () => {
    const { dir, tmHome, env } = project(withTests);
    expect(JSON.parse((await run(dir, env, ["status", "--json"])).out)).toEqual({ initialized: false, approved: false, check: null, kind: "git", configPath: expect.stringMatching(/timemachine\.yml$/) });
    expect((await run(dir, env, ["status"])).out).toMatch(/^Not set up: this project has no timemachine\.yml\. Run tm init\.\n {2}Settings {2}\/.+\/timemachine\.yml\n$/);
    expect(existsSync(tmHome)).toBe(false);
    await run(dir, env, ["init", "--no-approve"]);
    expect(JSON.parse((await run(dir, env, ["status", "--json"])).out)).toMatchObject({ initialized: true, approved: false, check: "npm test", kind: "git" });
    expect((await run(dir, env, ["status"])).out).toContain("Set up, but the check is not approved on this computer.");
    await run(dir, env, ["init"]);
    const r = await run(dir, env, ["status", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ initialized: true, approved: true, check: "npm test", kind: "git" });
    expect((await run(dir, env, ["status", "extra"])).code).toBe(64);
  });
});

describe("tm demo", () => {
  test("ends with the next step for the user's own project", async () => {
    const root = tempDir("clidemo");
    const env = { ...process.env, TM_HOME: join(root, "store") };
    const r = await run(root, env, ["demo", join(root, "marigold")]);
    expect(r.code).toBe(0);
    expect(r.out.trimEnd().split("\n").slice(-6)).toEqual([
      "Now protect your own project:",
      "  cd <your project>",
      "  tm init",
      "Then add the Claude Code plugin, so it saves before each prompt and risky command:",
      "  /plugin marketplace add ShadowEsu/Time-Machine",
      "  /plugin install time-machine@time-machine",
    ]);
  });
});
