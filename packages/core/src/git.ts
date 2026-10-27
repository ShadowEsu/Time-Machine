import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { TmError } from "./errors.js";
import { runSync, type RunResult } from "./exec.js";
import { clipSafe } from "./secrets.js";

/**
 * On every command: hooks and fsmonitor off, so a refresh or a ref update never starts a program a
 * repository's config names. Command-line settings win over any config file. For a plain folder, Git
 * never reads a config from inside the folder at all (see resolveProject).
 */
const GIT_FLAGS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", "-c", "core.quotepath=off"];

/** Git environment: no system config, no prompts, no optional index writes, a fixed identity for save point commits. */
export function gitEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  // The user's pathspec settings change what Time Machine's own pathspecs match, and clash with the literal ones it sets
  // (git refuses literal with any other), so none of them come through (Security L1).
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS", "GIT_LITERAL_PATHSPECS"]) delete env[k];
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

/** Where and with which environment a Git command for `cwd` runs: a plain folder's shadow dir only in that folder itself. */
function gitAt(cwd: string, base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv): { cwd: string; env: NodeJS.ProcessEnv } {
  const env = gitEnv(base, extra);
  const shadow = base[SHADOW_GIT_DIR];
  delete env[SHADOW_GIT_DIR];
  delete env[SHADOW_WORK_TREE];
  if (shadow && base[SHADOW_WORK_TREE] === cwd) {
    env.GIT_DIR = shadow;
    // A folder that was moved or deleted has no work tree. Commands that only read the history still run, from the shadow dir.
    if (!existsSync(cwd)) return { cwd: shadow, env };
    env.GIT_WORK_TREE = cwd;
  }
  return { cwd, env };
}

export function gitTry(cwd: string, base: NodeJS.ProcessEnv, args: string[], extra: NodeJS.ProcessEnv = {}): RunResult {
  return runSync("git", [...GIT_FLAGS, ...args], gitAt(cwd, base, extra));
}

/** A Git command's output as bytes, with `input` as bytes on stdin: Linux file names can be any bytes, not only UTF-8,
 *  and a name decoded to text and written back no longer names the same file (Security L1). */
export function gitBytes(cwd: string, base: NodeJS.ProcessEnv, args: string[], extra: NodeJS.ProcessEnv = {}, input?: Buffer): Buffer {
  const r = spawnSync("git", [...GIT_FLAGS, ...args], { ...gitAt(cwd, base, extra), input, maxBuffer: 256 * 1024 * 1024 });
  // r.error first: a full output buffer (ENOBUFS) or a Git that couldn't start says why only there.
  if (r.error) throw new TmError("internal", `git ${args[0] ?? ""} failed: ${r.error.message}`);
  if (r.status !== 0 || !Buffer.isBuffer(r.stdout)) throw new TmError("internal", `git ${args[0] ?? ""} failed: ${Buffer.isBuffer(r.stderr) ? r.stderr.toString("utf8").trim() : ""}`);
  return r.stdout;
}

/** NUL-separated bytes, as `git ... -z` prints them, split into entries without decoding. */
export function splitZBytes(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  for (let i = buf.indexOf(0); i !== -1; i = buf.indexOf(0, start)) {
    if (i > start) out.push(buf.subarray(start, i));
    start = i + 1;
  }
  if (start < buf.length) out.push(buf.subarray(start));
  return out;
}

/** The PATH values whose git already passed requireGit in this process. */
const gitChecked = new Set<string>();

/** Time Machine needs Git 2.36 or later (a recovery reads `git worktree list -z`, a save asks `--path-format`). Throws a usage
 *  error saying what is there. Asked once per process for each PATH, from resolveProject, where every command starts. */
export function requireGit(base: NodeJS.ProcessEnv): void {
  const key = base.PATH ?? "";
  if (gitChecked.has(key)) return;
  // "/" is always there; a missing TMPDIR or working folder must not read as a missing Git.
  const r = runSync("git", ["--version"], { cwd: "/", env: gitEnv(base) });
  if (r.code === 127) throw new TmError("usage", "Time Machine needs Git 2.36 or later, and Git isn't installed.");
  // macOS ships a git that only asks for the developer tools, and exits 1 until they are installed. Its first line is shown
  // clipped, without control characters or direction marks, so it can't move the cursor, recolour or reorder the terminal.
  if (r.code !== 0) throw new TmError("usage", `Time Machine needs Git 2.36 or later, and git --version failed: ${clipSafe(r.stderr.trim().split("\n")[0] ?? "", 200)}`);
  const m = /(\d+)\.(\d+)(?:\.\d+)?/.exec(r.stdout);
  if (m) {
    const [major, minor] = [Number(m[1]), Number(m[2])];
    if (major < 2 || (major === 2 && minor < 36)) throw new TmError("usage", `Time Machine needs Git 2.36 or later. This computer has Git ${m[0]}.`);
  }
  gitChecked.add(key);
}

/** A blob's bytes as they are, binary too, or null when Git can't read it. */
export function gitBlob(cwd: string, base: NodeJS.ProcessEnv, sha: string): Buffer | null {
  const r = spawnSync("git", [...GIT_FLAGS, "cat-file", "blob", sha], { ...gitAt(cwd, base, {}), maxBuffer: 1024 * 1024 * 1024 });
  return r.status === 0 && Buffer.isBuffer(r.stdout) ? r.stdout : null;
}

/** The blob ID Git gives `buf` as the file `rel`, after the conversions a save applies to it too (line endings, Git LFS),
 *  or null when Git can't say. Writes no Git object; a Git LFS clean filter may keep a copy in its own cache, as the save
 *  made just before already did. */
export function gitCleanId(cwd: string, base: NodeJS.ProcessEnv, rel: string, buf: Buffer): string | null {
  const r = spawnSync("git", [...GIT_FLAGS, "hash-object", "--stdin", `--path=${rel}`], { ...gitAt(cwd, base, {}), input: buf, maxBuffer: 1024 * 1024 });
  return r.status === 0 && Buffer.isBuffer(r.stdout) ? r.stdout.toString("utf8").trim() : null;
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
