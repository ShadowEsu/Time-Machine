import { TmError } from "./errors.js";
import { runSync, type RunResult } from "./exec.js";

/**
 * On every command: hooks and fsmonitor off, so a refresh or a ref update never starts a program a
 * repository's config names. Command-line settings win over any config file. For a plain folder, Git
 * never reads a config from inside the folder at all (see resolveProject).
 */
const GIT_FLAGS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", "-c", "core.quotepath=off"];

/** Git environment: no system config, no prompts, no optional index writes, a fixed identity for save point commits. */
export function gitEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"]) delete env[k];
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Time Machine",
    GIT_AUTHOR_EMAIL: "timemachine@localhost",
    GIT_COMMITTER_NAME: "Time Machine",
    GIT_COMMITTER_EMAIL: "timemachine@localhost",
    LC_ALL: "C",
    ...extra,
  };
}

/**
 * A plain folder project's history lives in a shadow Git dir in the store. Its Project.env names the
 * shadow dir and the folder with these two keys. Git gets them as GIT_DIR and GIT_WORK_TREE only for a
 * command run in that folder itself, so a command run in a copy or anywhere else never reaches it.
 */
export const SHADOW_GIT_DIR = "TM_SHADOW_GIT_DIR";
export const SHADOW_WORK_TREE = "TM_SHADOW_WORK_TREE";

export function gitTry(cwd: string, base: NodeJS.ProcessEnv, args: string[], extra: NodeJS.ProcessEnv = {}): RunResult {
  const env = gitEnv(base, extra);
  const shadow = base[SHADOW_GIT_DIR];
  delete env[SHADOW_GIT_DIR];
  delete env[SHADOW_WORK_TREE];
  if (shadow && base[SHADOW_WORK_TREE] === cwd) {
    env.GIT_DIR = shadow;
    env.GIT_WORK_TREE = cwd;
  }
  return runSync("git", [...GIT_FLAGS, ...args], { cwd, env });
}

export function git(cwd: string, base: NodeJS.ProcessEnv, args: string[], extra: NodeJS.ProcessEnv = {}): string {
  const r = gitTry(cwd, base, args, extra);
  if (r.code !== 0) throw new TmError("internal", `git ${args[0] ?? ""} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

export function splitZ(s: string): string[] {
  return s.split("\0").filter(Boolean);
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}

/** Removes any user name or token from a remote URL before it is recorded. */
export function safeRemote(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return url; // scp style (git@host:repo) has no secret part
  }
}
