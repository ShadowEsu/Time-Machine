// More than a commit comes back: lockfiles and environment definition files (Dockerfile, .nvmrc
// and similar) are saved even when .gitignore skips them, restored into the recovery copy, and
// checked against their recorded digests. Paths in environment.files must stay inside the project.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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

const base = {
  "package.json": JSON.stringify({ name: "app", scripts: { test: "node --test" } }),
  "index.test.js": "const t=require('node:test');t('ok',()=>{});\n",
  Dockerfile: "FROM node:22\n",
  ".gitignore": ".nvmrc\npnpm-lock.yaml\nnode_modules\n",
  ".nvmrc": "22\n",
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
};

describe("environment definition and lockfiles", () => {
  test("ignored lockfiles and environment files are saved, listed as restorable, and come back on recover", async () => {
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
});
