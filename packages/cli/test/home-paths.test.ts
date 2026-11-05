// A path under the home folder prints as ~/… in human output, so a screen recording never shows the username.
// --json keeps every path exact for scripts.
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { main } from "../src/main.ts";

interface Run { code: number; out: string; err: string }
async function run(cwd: string, env: NodeJS.ProcessEnv, ...argv: string[]): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, { cwd, env, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, isTTY: false });
  return { code, out, err };
}

let home: string;
let homes: string[];
let env: NodeJS.ProcessEnv;
let dir: string;
let demo: Run;

beforeAll(async () => {
  const root = tempDir("clihome");
  home = join(root, "home");
  mkdirSync(home);
  // A Mac's temp folder is under /var, which is /private/var after realpath. Neither form may show.
  homes = [...new Set([home, realpathSync(home)])];
  env = { ...process.env, HOME: home, TM_HOME: join(home, ".timemachine"), GIT_CEILING_DIRECTORIES: root };
  dir = join(home, "code", "marigold");
  demo = await run(root, env, "demo", dir);
}, 120_000);

const shows = (text: string): string[] => homes.filter((h) => text.includes(h));

describe("paths under the home folder", () => {
  test("tm demo prints ~/ and never the home folder", () => {
    expect(demo.code).toBe(0);
    expect(shows(demo.out)).toEqual([]);
    expect(demo.out).toContain("Built a demo project, Marigold Tips, in ~/code/marigold\n");
    expect(demo.out).toMatch(/^ {2}Recovery copy {3}~\/code\/marigold-recovered-cp-\d+$/m);
    expect(demo.out).toMatch(/^Report: ~\/\.timemachine\//m);
    expect(demo.out).toContain("\n  cd ~/code/marigold\n");
  });

  test("tm recover prints ~/ and never the home folder; --json keeps the full path", async () => {
    const text = await run(dir, env, "recover", "cp-0003");
    expect(text.code).toBe(0);
    expect(shows(text.out)).toEqual([]);
    expect(text.out).toMatch(/^ {2}Recovery copy {3}~\/code\/marigold-recovered-cp-0003\S*$/m);
    expect(text.out).toMatch(/^Report: ~\/\.timemachine\//m);

    const json = await run(dir, env, "recover", "cp-0003", "--json");
    const r = JSON.parse(json.out) as { copyDir: string; reportPath: string };
    expect(homes.some((h) => r.copyDir.startsWith(`${h}/code/marigold-recovered-cp-0003`))).toBe(true);
    expect(homes.some((h) => r.reportPath.startsWith(`${h}/.timemachine/`))).toBe(true);
  });

  test("tm demo --json keeps the full path", async () => {
    const json = await run(home, env, "demo", join(home, "code", "marigold-json"), "--json");
    expect(json.code).toBe(0);
    const r = JSON.parse(json.out) as { dir: string; recover: { copyDir: string; reportPath: string } };
    expect(homes.some((h) => r.dir === `${h}/code/marigold-json`)).toBe(true);
    expect(homes.some((h) => r.recover.copyDir.startsWith(`${h}/`))).toBe(true);
    expect(homes.some((h) => r.recover.reportPath.startsWith(`${h}/.timemachine/`))).toBe(true);
  });

  test("an error on stderr prints ~/ too", async () => {
    const r = await run(home, env, "demo", dir);
    expect(r.code).toBe(64);
    expect(r.err).toBe("tm: ~/code/marigold is not empty. The demo only builds in a new or empty folder.\n");
  });
});
