import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { TmError } from "./errors.js";
import { gitTry } from "./git.js";
import type { Ctx } from "./types.js";

export interface Project {
  root: string;
  name: string;
  env: NodeJS.ProcessEnv;
  home: string;
  store: string;
}

export function resolveProject(ctx: Ctx): Project {
  const env = ctx.env ?? process.env;
  const r = gitTry(ctx.cwd, env, ["rev-parse", "--show-toplevel"]);
  if (r.code !== 0) throw new TmError("not_found", "This folder is not inside a Git repository. Run git init and make a first commit, then try again.");
  const root = realpathSync(r.stdout.trim());
  const home = ctx.tmHome ?? env.TM_HOME ?? join(homedir(), ".timemachine");
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return { root, name: basename(root), env, home, store: join(home, "projects", key) };
}

/** The store folder for the project that contains ctx.cwd. */
export function storeDirFor(ctx: Ctx): string {
  return resolveProject(ctx).store;
}
