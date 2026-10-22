import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { TmError } from "./errors.js";
import { gitTry } from "./git.js";
import { isInside } from "./paths.js";
import type { Ctx } from "./types.js";

export interface Project {
  root: string;
  name: string;
  env: NodeJS.ProcessEnv;
  home: string;
  store: string;
}

/** The top folder of the Git repository that contains ctx.cwd, or null outside one. */
export function gitRoot(ctx: Ctx): string | null {
  const r = gitTry(ctx.cwd, ctx.env ?? process.env, ["rev-parse", "--show-toplevel"]);
  return r.code === 0 ? realpathSync(r.stdout.trim()) : null;
}

export function resolveProject(ctx: Ctx): Project {
  const env = ctx.env ?? process.env;
  const root = gitRoot(ctx);
  if (root === null) throw new TmError("not_found", "This folder is not inside a Git repository. Run git init and make a first commit, then try again.");
  const home = resolve(ctx.cwd, ctx.tmHome ?? env.TM_HOME ?? join(homedir(), ".timemachine"));
  if (isInside(root, home)) throw new TmError("usage", `The Time Machine store (${home}) is inside the project. Point TM_HOME somewhere outside it.`);
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return { root, name: basename(root), env, home, store: join(home, "projects", key) };
}

/** The store folder for the project that contains ctx.cwd. */
export function storeDirFor(ctx: Ctx): string {
  return resolveProject(ctx).store;
}
