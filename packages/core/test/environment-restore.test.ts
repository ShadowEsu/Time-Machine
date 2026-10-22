// More than a commit comes back: lockfiles and version pins (.nvmrc and similar) are saved even when
// .gitignore skips them, restored into the recovery copy, and checked against their recorded digests.
// Other environment definition files (Dockerfile, compose, devcontainer) come back only when Git has
// them; when ignored they can hold secrets, so only their digest is kept. Paths in environment.files
// must stay inside the project.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";

function repo(files: Record<string, string>): { dir: string; ctx: tm.Ctx } {
  const root = tempDir("envrestore");
  const dir = join(root, "app");
  for (const [name, text] of Object.entries(files)) write(dir, name, text);
  git(root, "init", "-q", "-b", "main", dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  const tmHome = join(root, "store");
  return { dir, ctx: { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } } };
}

/** The files a save point holds in the store, by path, with their saved text. */
function stored(ctx: tm.Ctx, id: string): Record<string, string> {
  const store = tm.storeDirFor(ctx);
  const m = JSON.parse(readFileSync(join(store, "checkpoints", `${id}.json`), "utf8")) as { files: { path: string; sha256: string }[] };
  return Object.fromEntries(m.files.map((f) => [f.path, gunzipSync(readFileSync(join(store, "objects", f.sha256.slice(0, 2), `${f.sha256.slice(2)}.gz`))).toString("utf8")]));
}

const base = {
  "package.json": JSON.stringify({ name: "app", scripts: { test: "node --test" } }),
  "index.test.js": "const t=require('node:test');t('ok',()=>{});\n",
  Dockerfile: "FROM node:22\n",
  ".gitignore": ".nvmrc\npnpm-lock.yaml\nnode_modules\n",
  ".nvmrc": "22\n",
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
};

describe("environment definition and lockfiles", () => {
  test("ignored lockfiles and version pins are saved, listed as restorable, and come back on recover", async () => {
    const { dir, ctx } = repo(base);
    await tm.init(ctx);
    const cp = await tm.checkpoint(ctx, { note: "works" });
    expect(cp.checkpoint.coverage.captured).toContain("Environment definition: Dockerfile, .nvmrc");
    expect(cp.checkpoint.coverage.captured).toContain("Dependencies: pnpm-lock.yaml");
    expect(cp.checkpoint.coverage.restorable).toContain("Environment definition: Dockerfile, .nvmrc");
    expect(cp.checkpoint.coverage.restorable).toContain("Dependencies: pnpm-lock.yaml");
    expect(cp.checkpoint.coverage.manual.join("\n")).not.toContain(".nvmrc");
    // A later change to the ignored files is not in Git. Recovery must still bring the saved versions back.
    writeFileSync(join(dir, ".nvmrc"), "24\n");
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '10.0'\n");
    const r = await tm.recover(ctx, cp.checkpoint.id);
    expect(readFileSync(join(r.copyDir, ".nvmrc"), "utf8")).toBe("22\n");
    expect(readFileSync(join(r.copyDir, "pnpm-lock.yaml"), "utf8")).toBe("lockfileVersion: '9.0'\n");
    expect(readFileSync(join(r.copyDir, "Dockerfile"), "utf8")).toBe("FROM node:22\n");
    expect(r.restored).toContain("Environment definition: Dockerfile, .nvmrc");
    expect(r.restored).toContain("Dependencies: pnpm-lock.yaml");
    // The user's folder keeps the newer files.
    expect(readFileSync(join(dir, ".nvmrc"), "utf8")).toBe("24\n");
  });

  test("a saved environment file whose copy was lost is reported, not claimed as restored", async () => {
    const { ctx } = repo(base);
    await tm.init(ctx);
    const cp = await tm.checkpoint(ctx, { note: "works" });
    const r1 = await tm.open(ctx, cp.checkpoint.id);
    expect(r1.restored).toContain("Environment definition: Dockerfile, .nvmrc");
    // Lose the saved copy of .nvmrc from the store: the blob is content addressed, so find it by digest.
    const store = tm.storeDirFor(ctx);
    const manifest = JSON.parse(readFileSync(join(store, "checkpoints", `${cp.checkpoint.id}.json`), "utf8")) as { files: { path: string; sha256: string }[] };
    const nvm = manifest.files.find((f) => f.path === ".nvmrc");
    expect(nvm).toBeDefined();
    rmSync(join(store, "objects", nvm!.sha256.slice(0, 2), `${nvm!.sha256.slice(2)}.gz`));
    const r2 = await tm.open(ctx, cp.checkpoint.id);
    expect(r2.restored).not.toContain("Environment definition: Dockerfile, .nvmrc");
    expect(r2.missing.join("\n")).toContain(".nvmrc");
  });

  test("environment.files must stay inside the project", async () => {
    const { dir, ctx } = repo(base);
    await tm.init(ctx);
    const yml = readFileSync(join(dir, "timemachine.yml"), "utf8");
    writeFileSync(join(dir, "timemachine.yml"), yml + "environment:\n  files:\n    - ../outside\n");
    await expect(tm.checkpoint(ctx, { note: "x" })).rejects.toThrow(/inside the project/);
  });

  test("ignored Dockerfile, compose and devcontainer files never enter the store; pins and lockfiles still do", async () => {
    // The secret scan only matches NAME=value at a line start. These forms slip past it, so ignored definitions keep only a digest.
    const secrets = {
      Dockerfile: "FROM node:22\nENV DB_PASSWORD=hunter2hunter2\nENV API_SECRET hunter3hunter3\nARG NPM_TOKEN=abcdef0123456789\n",
      "docker-compose.yml": "services:\n  db:\n    image: postgres\n    environment:\n      - POSTGRES_PASSWORD=supersecretpw\n",
      "compose.yaml": "services:\n  web:\n    environment:\n      - API_TOKEN=tok_0123456789abcdef\n",
      ".devcontainer/devcontainer.json": JSON.stringify({ image: "node:22", containerEnv: { DB_PASSWORD: "hunter2hunter2" } }) + "\n",
    };
    const pins = { ".nvmrc": "22\n", ".tool-versions": "nodejs 22.0.0\n", "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" };
    const { dir, ctx } = repo({
      "package.json": JSON.stringify({ name: "app", scripts: { test: "node --test" } }),
      "index.test.js": "const t=require('node:test');t('ok',()=>{});\n",
      ".gitignore": [...Object.keys(secrets), ...Object.keys(pins)].join("\n") + "\n",
      ...secrets,
      ...pins,
    });
    await tm.init(ctx);
    const cp = await tm.checkpoint(ctx, { note: "works" });
    const files = stored(ctx, cp.checkpoint.id);
    expect(Object.keys(files).sort()).toEqual([".nvmrc", ".tool-versions", "pnpm-lock.yaml", "timemachine.yml"]);
    expect(Object.values(files).join("\n")).not.toMatch(/hunter2|hunter3|supersecretpw|abcdef0123456789|tok_0123456789abcdef/);
    // Still fingerprinted, so diff sees a change, but never offered or claimed as restored.
    expect(cp.checkpoint.coverage.captured).toContain("Environment definition: Dockerfile, docker-compose.yml, compose.yaml, .nvmrc, .tool-versions, .devcontainer/devcontainer.json");
    expect(cp.checkpoint.coverage.restorable).toContain("Environment definition: .nvmrc, .tool-versions");
    expect(cp.checkpoint.coverage.restorable).toContain("Dependencies: pnpm-lock.yaml");
    expect(cp.checkpoint.coverage.manual.join("\n")).toMatch(/Files your \.gitignore skips were not saved: .*Dockerfile/);
    const r = await tm.recover(ctx, cp.checkpoint.id);
    expect(r.restored).toContain("Environment definition: .nvmrc, .tool-versions");
    expect(r.restored.join("\n")).not.toMatch(/Dockerfile|compose|devcontainer/);
    for (const name of Object.keys(secrets)) expect(existsSync(join(r.copyDir, name)), name).toBe(false);
    // The user's own ignored files are untouched.
    expect(readFileSync(join(dir, "Dockerfile"), "utf8")).toBe(secrets.Dockerfile);
  });

  test("a glob in environment.files never pulls other ignored files into the store", async () => {
    // environment.files entries reach git as pathspecs. Only exact version pin names are taken past .gitignore.
    const { ctx } = repo({
      "package.json": "{}",
      ".gitignore": "*.tfvars\nnode_modules/\n",
      "timemachine.yml": 'version: 1\nenvironment:\n  files: ["*.tfvars", "node_modules"]\n',
      "infra/prod/terraform.tfvars": 'db_password = "hunter2hunter2"\n',
      "node_modules/x/index.js": "module.exports = 1;\n",
    });
    const cp = await tm.checkpoint(ctx, { note: "x" });
    expect(Object.keys(stored(ctx, cp.checkpoint.id))).toEqual([]);
  });
});
