// init must guess an install step for projects with dependencies. Checks run in a fresh copy
// with no node_modules, so without one every check of a real Node project fails to start.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";

function repo(files: Record<string, string>): { dir: string; ctx: tm.Ctx } {
  const root = tempDir("initsetup");
  const dir = join(root, "app");
  for (const [name, text] of Object.entries(files)) write(dir, name, text);
  git(root, "init", "-q", "-b", "main", dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  const tmHome = join(root, "store");
  return { dir, ctx: { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } } };
}

const withDeps = JSON.stringify({ name: "app", scripts: { test: "ava" }, devDependencies: { ava: "^6.0.0" } });

describe("init guesses the install step", () => {
  test.each([
    ["package-lock.json", "npm ci --prefer-offline --no-audit --no-fund"],
    ["npm-shrinkwrap.json", "npm ci --prefer-offline --no-audit --no-fund"],
    ["pnpm-lock.yaml", "pnpm install --frozen-lockfile --prefer-offline"],
    ["yarn.lock", "yarn install --frozen-lockfile --prefer-offline"],
  ])("uses the lockfile's installer for %s", async (lockfile, setup) => {
    const { dir, ctx } = repo({ "package.json": withDeps, [lockfile]: "{}\n" });
    const r = await tm.init(ctx);
    expect(r.verifySetup).toBe(setup);
    expect(readFileSync(join(dir, "timemachine.yml"), "utf8")).toContain(`setup: ${JSON.stringify(setup)}`);
  });

  test("falls back to npm install when there is no lockfile", async () => {
    const { ctx } = repo({ "package.json": withDeps });
    expect((await tm.init(ctx)).verifySetup).toBe("npm install --prefer-offline --no-audit --no-fund");
  });

  test("adds no install step when nothing needs installing", async () => {
    const { dir, ctx } = repo({ "package.json": JSON.stringify({ name: "app", scripts: { test: "node --test" } }) });
    const r = await tm.init(ctx);
    expect(r.verifySetup).toBe("");
    expect(readFileSync(join(dir, "timemachine.yml"), "utf8")).toContain('setup: ""');
    const plain = repo({ "Cargo.toml": "[package]\nname = \"app\"\n" });
    expect((await tm.init(plain.ctx)).verifySetup).toBe("");
  });

  test("keeps an existing timemachine.yml and reports its setup", async () => {
    const { ctx } = repo({ "package.json": withDeps, "package-lock.json": "{}\n" });
    await tm.init(ctx);
    expect((await tm.init(ctx)).verifySetup).toBe("npm ci --prefer-offline --no-audit --no-fund");
  });
});
