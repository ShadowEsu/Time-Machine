import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { TmError } from "./errors.js";
import { git, gitTry, SHADOW_GIT_DIR, SHADOW_WORK_TREE } from "./git.js";
import { isInside, privateDir } from "./paths.js";
import type { Ctx } from "./types.js";

/** "git": a Git repository. "folder": a plain folder whose history lives in a shadow Git dir in the store. */
export type ProjectKind = "git" | "folder";

export interface Project {
  root: string;
  name: string;
  /** For a folder project it also names the shadow Git dir, which the git helpers use only inside the folder. */
  env: NodeJS.ProcessEnv;
  home: string;
  store: string;
  kind: ProjectKind;
}

/** The shadow Git dir of a folder project, inside its store folder. */
const SHADOW = "shadow.git";

/**
 * The top folder of the Git repository that contains ctx.cwd, or null outside one. Paths here and in
 * resolveProject use the native realpath, which gives the letter case on disk, so one folder spelled
 * two ways on a case-insensitive volume is one project with one store.
 */
export function gitRoot(ctx: Ctx): string | null {
  const r = gitTry(ctx.cwd, ctx.env ?? process.env, ["rev-parse", "--show-toplevel"]);
  return r.code === 0 ? realpathSync.native(r.stdout.trim()) : null;
}

function storeFor(home: string, root: string): string {
  return join(home, "projects", createHash("sha256").update(root).digest("hex").slice(0, 16));
}

/** The folder project at `dir` or above it: the nearest folder whose store holds a shadow Git dir. Only checks paths in the store. */
function folderRoot(dir: string, home: string): string | null {
  for (let cur = dir; ; cur = dirname(cur)) {
    if (existsSync(join(storeFor(home, cur), SHADOW, "HEAD"))) return cur;
    if (dirname(cur) === cur) return null;
  }
}

/**
 * The project that contains ctx.cwd: a Git repository, or a plain folder added before. A folder
 * project always wins: Git is never asked about a folder Time Machine protects, so a .git someone
 * puts in it or in a subfolder later (a shared folder's collaborator, an unpacked archive, an agent)
 * can never move its history or have its config read; saving skips it as it skips any nested .git. With
 * `create`, a plain folder outside any repository becomes a folder project: "write" makes its shadow
 * Git dir in the store, never in the folder; "plan" only reports the project it would be and writes nothing.
 */
export function resolveProject(ctx: Ctx, opts: { create?: "write" | "plan" } = {}): Project {
  const env: NodeJS.ProcessEnv = { ...(ctx.env ?? process.env) };
  // Only this function names a shadow dir. Values inherited from a parent process never count.
  delete env[SHADOW_GIT_DIR];
  delete env[SHADOW_WORK_TREE];
  const home = resolve(ctx.cwd, ctx.tmHome ?? env.TM_HOME ?? join(homedir(), ".timemachine"));
  let cwd: string;
  try {
    cwd = realpathSync.native(ctx.cwd);
  } catch {
    throw new TmError("not_found", `${ctx.cwd} does not exist.`);
  }
  let folder = folderRoot(cwd, home);
  const repo = folder === null ? gitRoot({ ...ctx, env }) : null;
  if (folder === null && repo === null && opts.create) folder = cwd;
  const root = folder ?? repo;
  if (root === null) {
    throw new TmError("not_found", "This folder is not inside a Git repository, and it is not a folder Time Machine protects yet. Add it in the app or run tm init to protect it as a plain folder. For a code project, run git init and make a first commit.");
  }
  if (isInside(root, home)) throw new TmError("usage", `The Time Machine store (${home}) is inside the project. Point TM_HOME somewhere outside it.`);
  const store = storeFor(home, root);
  if (folder === null) return { root, name: basename(root), env, home, store, kind: "git" };
  const shadow = join(store, SHADOW);
  if (opts.create !== "plan" && !existsSync(join(shadow, "HEAD"))) {
    // Made from the store folder, so Git never looks at or writes in the user's folder. Only this user can get in.
    privateDir(home);
    privateDir(store);
    git(store, env, ["init", "-q", "--bare", shadow]);
    git(store, env, ["--git-dir", shadow, "config", "core.bare", "false"]);
  }
  return { root, name: basename(root), env: { ...env, [SHADOW_GIT_DIR]: shadow, [SHADOW_WORK_TREE]: root }, home, store, kind: "folder" };
}

/** Where a project's timemachine.yml lives: the repository root, or the store for a plain folder, which is never written. */
export function configRoot(p: Project): string {
  return p.kind === "folder" ? p.store : p.root;
}

/** The store folder for the project that contains ctx.cwd. */
export function storeDirFor(ctx: Ctx): string {
  return resolveProject(ctx).store;
}
