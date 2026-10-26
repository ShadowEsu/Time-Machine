import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { TmError } from "./errors.js";
import { git, gitTry, requireGit, SHADOW_GIT_DIR, SHADOW_WORK_TREE } from "./git.js";
import { isInside, privateDir, realish } from "./paths.js";
import { UNSAFE_CHARS } from "./secrets.js";
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
  /**
   * True when the folder is not on disk (moved or deleted). Only a folder project resolves then: its
   * history lives in the store, so its save points can still be listed, opened and brought back.
   */
  missing: boolean;
}

/** The shadow Git dir of a folder project, inside its store folder. */
export const SHADOW = "shadow.git";

/** Each project store's record of the folder it protects. Older stores may lack the newer fields. */
const META = "project.json";
const MetaSchema = z.looseObject({
  storeVersion: z.literal(1),
  root: z.string(),
  createdAt: z.string(),
  /** For a Git project: the repository's common Git dir, so a second worktree of it is never protected too. */
  gitCommonDir: z.string().optional(),
  movedFrom: z.string().optional(),
  movedAt: z.string().optional(),
});
export type ProjectMeta = z.infer<typeof MetaSchema>;

export function readMeta(store: string): ProjectMeta | null {
  try {
    const r = MetaSchema.safeParse(JSON.parse(readFileSync(join(store, META), "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function writeMeta(store: string, meta: ProjectMeta): void {
  const path = join(store, META);
  // A temp name of this process's own, so two writers never rename each other's half-written file away.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(meta, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** The store home for ctx: ctx.tmHome, then $TM_HOME, then ~/.timemachine. */
export function tmHome(ctx: Ctx): string {
  const env = ctx.env ?? process.env;
  return resolve(ctx.cwd, ctx.tmHome ?? env.TM_HOME ?? join(homedir(), ".timemachine"));
}

/**
 * The top folder of the Git repository that contains ctx.cwd, or null outside one. Paths here and in
 * resolveProject use the native realpath, which gives the letter case on disk, so one folder spelled
 * two ways on a case-insensitive volume is one project with one store.
 */
export function gitRoot(ctx: Ctx): string | null {
  const r = gitTry(ctx.cwd, ctx.env ?? process.env, ["rev-parse", "--show-toplevel"]);
  return r.code === 0 ? realpathSync.native(r.stdout.trim()) : null;
}

export function storeFor(home: string, root: string): string {
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
 * A folder project whose folder was moved or deleted still resolves, with `missing` set: its history is in the store.
 */
export function resolveProject(ctx: Ctx, opts: { create?: "write" | "plan" } = {}): Project {
  const env: NodeJS.ProcessEnv = { ...(ctx.env ?? process.env) };
  // Every project command starts here, so this is where an older Git is refused (Security L2).
  requireGit(env);
  // Only this function names a shadow dir. Values inherited from a parent process never count.
  delete env[SHADOW_GIT_DIR];
  delete env[SHADOW_WORK_TREE];
  const home = tmHome({ ...ctx, env });
  let cwd: string;
  let gone = false;
  try {
    cwd = realpathSync.native(ctx.cwd);
  } catch {
    cwd = realish(resolve(ctx.cwd));
    gone = true;
  }
  let folder = folderRoot(cwd, home);
  if (gone) {
    if (opts.create) throw new TmError("usage", `${ctx.cwd} does not exist, so there is nothing to protect there.`);
    if (folder === null) {
      if (readMeta(storeFor(home, cwd))) {
        throw new TmError("not_found", `${cwd} is not there any more. It is a Git project, so its save points live in its .git folder, which went with it. Move the folder back, or if it moved, run tm relink ${cwd} <new path>.`);
      }
      throw new TmError("not_found", `${ctx.cwd} does not exist.`);
    }
  }
  const repo = folder === null ? gitRoot({ ...ctx, env }) : null;
  if (folder === null && repo === null && opts.create) folder = cwd;
  const root = folder ?? repo;
  if (root === null) {
    throw new TmError("not_found", "This folder is not inside a Git repository, and it is not a folder Time Machine protects yet. Add it in the app or run tm init to protect it as a plain folder. For a code project, run git init and make a first commit.");
  }
  if (isInside(root, home)) throw new TmError("usage", `The Time Machine store (${home}) is inside the project. Point TM_HOME somewhere outside it.`);
  const store = storeFor(home, root);
  if (folder === null) {
    const p: Project = { root, name: basename(root), env, home, store, kind: "git", missing: false };
    if (opts.create === "write") assertOwnGitDir(p);
    return p;
  }
  const shadow = join(store, SHADOW);
  if (opts.create !== "plan" && !existsSync(join(shadow, "HEAD"))) {
    // Made from the store folder, so Git never looks at or writes in the user's folder. Only this user can get in.
    privateDir(home);
    privateDir(store);
    git(store, env, ["init", "-q", "--bare", shadow]);
    git(store, env, ["--git-dir", shadow, "config", "core.bare", "false"]);
  }
  const p: Project = { root, name: basename(root), env: { ...env, [SHADOW_GIT_DIR]: shadow, [SHADOW_WORK_TREE]: root }, home, store, kind: "folder", missing: !existsSync(root) };
  // Recorded now, so the store can name the folder before its first save point.
  if (opts.create === "write") recordProject(p);
  return p;
}

/** Writes the store's project.json the first time. A Git project is refused here when another project already protects its repository. */
export function recordProject(p: Project): void {
  if (existsSync(join(p.store, META))) return;
  let gitCommonDir: string | undefined;
  if (p.kind === "git") {
    assertOwnGitDir(p);
    gitCommonDir = commonDir(p.root, p.env) ?? undefined;
  }
  privateDir(p.store);
  writeMeta(p.store, { storeVersion: 1, root: p.root, createdAt: new Date().toISOString(), ...(gitCommonDir ? { gitCommonDir } : {}) });
}

/** The repository's common Git dir (the main .git for every worktree of it), or null when Git says this isn't a repository.
 *  Any other answer than one full path to a folder that is there throws: an older Git can print `--path-format` back with
 *  exit code 0, and an answer that matches nothing would let two projects share one .git unnoticed (Security L2). */
function commonDir(root: string, env: NodeJS.ProcessEnv): string | null {
  const r = gitTry(root, env, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.code !== 0) return null;
  const out = r.stdout.trim();
  const said = `Git named the repository's folder as "${out.replace(/\s+/g, " ").replace(UNSAFE_CHARS, "").slice(0, 120)}", not one full path. Time Machine needs Git 2.36 or later.`;
  // A usage error, like requireGit's: the fix is a newer Git. realpath also refuses an answer with more than one line.
  if (!isAbsolute(out)) throw new TmError("usage", said);
  try {
    return realpathSync.native(out);
  } catch {
    throw new TmError("usage", said);
  }
}

/** A repository folder a store recorded, or null when it isn't one full path on one line: a build before 574c1ec could
 *  store an older Git's echoed answer, which must be asked again, not trusted (Security next-pass LOW). */
function storedCommonDir(value: string | undefined): string | null {
  return value !== undefined && isAbsolute(value) && !/[\r\n]/.test(value) ? value : null;
}

/** The real folder a recorded path leads to now, or null when it isn't a folder: gone, a .git file a move left behind
 *  (absorbgitdirs, --separate-git-dir), unreadable, or a link loop. Never throws: another project's odd path must not
 *  stop this one's saves. Compared by where it leads, so a link to the same .git still matches (Security 2c44582 LOWs). */
function realDir(path: string): string | null {
  try {
    return statSync(path).isDirectory() ? realpathSync.native(path) : null;
  } catch {
    return null;
  }
}

/**
 * Another project in the store on the same Git repository (a second worktree, say) that was protected
 * first, or null. Both would write the same refs/tm/cp-N in the one .git, so only the first is kept.
 * The project's own repository folder is asked of Git every time (one rev-parse) and written back to its
 * store when it changed. Another store's recorded value is used, by the real folder it leads to, only while that is
 * still the real folder of its root's .git (a stat and a realpath; a linked worktree's .git is a file, so it is always
 * asked). A root that is gone keeps its recorded value: a removed worktree's Git folder lives on in the repository, and
 * the worst a wrong value can do there is refuse, never let two projects share refs. Otherwise it is asked again in
 * memory only: that store is written only by its own project.
 */
export function sharedGitOwner(p: Project): string | null {
  if (p.kind !== "git") return null;
  const own = readMeta(p.store);
  const common = commonDir(p.root, p.env);
  if (!common) return null;
  // Only while the store still names this root: a relink moving it here writes its own project.json after letting go of
  // the lock, and a write from the old meta could put the old root back (Security next-pass LOW).
  if (own && own.root === p.root && own.gitCommonDir !== common) writeMeta(p.store, { ...own, gitCommonDir: common });
  const dir = join(p.home, "projects");
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const store = join(dir, name);
    if (store === p.store || existsSync(join(store, SHADOW, "HEAD"))) continue;
    const meta = readMeta(store);
    if (!meta || meta.root === p.root) continue;
    let other = storedCommonDir(meta.gitCommonDir);
    if (other !== null) other = realDir(other);
    // Some other folder at the recorded path, or a .git that moved: trust it only while it is still this root's own .git.
    // With the root gone there is nothing to compare with, so the recorded value stands (Security b90c40e).
    if (other !== null && existsSync(meta.root) && other !== realDir(join(meta.root, ".git"))) other = null;
    if (other === null) {
      if (!existsSync(meta.root)) continue;
      try {
        other = commonDir(meta.root, p.env);
      } catch {
        // Another project's broken repository is that project's to fix; it doesn't stop this one.
        continue;
      }
      if (other === null) continue;
    }
    if (other !== common) continue;
    if (!own || meta.createdAt < own.createdAt || (meta.createdAt === own.createdAt && meta.root < p.root)) return meta.root;
  }
  return null;
}

/** Refuses a Git project whose repository another project already protects. */
export function assertOwnGitDir(p: Project): void {
  const other = sharedGitOwner(p);
  if (other !== null) throw new TmError("usage", `${p.root} shares its Git repository with ${other}, which Time Machine already protects. Protect one of them.`);
}

/** The project a store folder holds, from its project.json, or null when the store does not say. The folder may be gone. */
export function projectFromStore(home: string, store: string, base: NodeJS.ProcessEnv = process.env): Project | null {
  const meta = readMeta(store);
  if (!meta) return null;
  const env: NodeJS.ProcessEnv = { ...base };
  delete env[SHADOW_GIT_DIR];
  delete env[SHADOW_WORK_TREE];
  const folder = existsSync(join(store, SHADOW, "HEAD"));
  return {
    root: meta.root,
    name: basename(meta.root),
    env: folder ? { ...env, [SHADOW_GIT_DIR]: join(store, SHADOW), [SHADOW_WORK_TREE]: meta.root } : env,
    home,
    store,
    kind: folder ? "folder" : "git",
    missing: !existsSync(meta.root),
  };
}

/** Every project the store under ctx's home knows, oldest store folder name first. */
export function storeProjectList(ctx: Ctx): Project[] {
  const home = tmHome(ctx);
  // tm list and tm doctor start here, not in resolveProject; both read Git.
  requireGit(ctx.env ?? process.env);
  const dir = join(home, "projects");
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const p = projectFromStore(home, join(dir, n), ctx.env ?? process.env);
    return p ? [p] : [];
  });
}

/** Where a project's timemachine.yml lives: the repository root, or the store for a plain folder, which is never written. */
export function configRoot(p: Project): string {
  return p.kind === "folder" ? p.store : p.root;
}

/** The store folder for the project that contains ctx.cwd. */
export function storeDirFor(ctx: Ctx): string {
  return resolveProject(ctx).store;
}
