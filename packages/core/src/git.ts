import { TmError } from "./errors.js";
import { runSync, type RunResult } from "./exec.js";

const GIT_FLAGS = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.quotepath=off"];

/** Git environment: no prompts, no optional index writes, a fixed identity for save point commits. */
export function gitEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"]) delete env[k];
  return {
    ...env,
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

export function gitTry(cwd: string, base: NodeJS.ProcessEnv, args: string[], extra: NodeJS.ProcessEnv = {}): RunResult {
  return runSync("git", [...GIT_FLAGS, ...args], { cwd, env: gitEnv(base, extra) });
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
