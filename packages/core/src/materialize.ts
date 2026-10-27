import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TmError } from "./errors.js";
import { git, gitTry, short } from "./git.js";
import type { Manifest } from "./manifest.js";
import type { Project } from "./project.js";
import { safeTarget } from "./paths.js";
import { getBlob, sha256 } from "./store.js";

export interface Materialized {
  dir: string;
  restored: string[];
  /** What the copy lacks from the save point, one sentence each. */
  missing: string[];
  /** Paths whose saved copy is gone from the store. */
  gone: string[];
  manual: string[];
  plainEnv: Record<string, string>;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The sentence for a saved file whose saved copy is no longer in the store. */
export function goneFromStore(path: string): string {
  return `the saved copy of ${path} is gone from the store`;
}

/**
 * What is wrong with a save point's pinned ref, or null when it points at the commit the manifest recorded.
 * `actual` is the commit the ref points at now, undefined when there is no such ref.
 */
export function refProblem(m: Manifest, actual: string | undefined): { kind: "not_found" | "integrity"; message: string } | null {
  if (actual === undefined) return { kind: "not_found", message: `The Git commit for ${m.id} is missing from this repository.` };
  if (actual !== m.git.snapshot) return { kind: "integrity", message: `${m.id} failed its integrity check. Its Git ref was moved.` };
  return null;
}

/** The pinned ref must still point at the commit the manifest recorded. */
export function checkRef(p: Project, m: Manifest): void {
  const r = gitTry(p.root, p.env, ["rev-parse", "--verify", "-q", `refs/tm/${m.id}^{commit}`]);
  const problem = refProblem(m, r.code === 0 ? r.stdout.trim() : undefined);
  if (problem) throw new TmError(problem.kind, problem.message);
}

export function removeWorktree(p: Project, dir: string): void {
  gitTry(p.root, p.env, ["worktree", "remove", "--force", dir]);
  rmSync(dir, { recursive: true, force: true });
  gitTry(p.root, p.env, ["worktree", "prune"]);
}

/** A plain copy is as closed as the folder it comes from: that folder's mode, or 0700 when it can't be read (or is gone). */
function copyMode(root: string): number {
  try {
    return statSync(root).mode & 0o777;
  } catch {
    return 0o700;
  }
}

/**
 * Rebuilds a checkpoint in a separate Git worktree. The user's working copy,
 * index and current branch are never touched. With `plain`, for a plain folder's save point
 * (an empty commit plus saved files), it writes a folder of plain files with no Git link at all.
 * Saved files keep the modified time they had when saved, when the save point recorded it.
 */
export function materialize(p: Project, m: Manifest, dir: string, opts: { branch?: string; plain?: boolean } = {}): Materialized {
  checkRef(p, m);
  // lstat, so a symbolic link at the name counts as taken even when it points nowhere.
  const there = lstatSync(dir, { throwIfNoEntry: false });
  if (there) throw new TmError("usage", there.isDirectory() ? `${dir} already exists. Pick another folder.` : `${dir} is a file, not a folder. Pick a folder that does not exist yet.`);
  if (opts.plain && p.kind !== "folder") throw new TmError("internal", "Only a plain folder's save point can be written as plain files.");
  mkdirSync(dirname(dir), { recursive: true });
  if (opts.plain) {
    try {
      mkdirSync(dir, { mode: copyMode(p.root) });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new TmError("usage", `${dir} was made by something else just now. Nothing was written there; try again.`);
      throw e;
    }
  } else git(p.root, p.env, opts.branch ? ["worktree", "add", "-q", dir, opts.branch] : ["worktree", "add", "-q", "--detach", dir, m.git.snapshot]);
  try {
    const missing: string[] = [];
    const gone: string[] = [];
    let written = 0;
    for (const f of m.files) {
      const buf = getBlob(p, f.sha256, f.path);
      if (!buf) {
        gone.push(f.path);
        missing.push(goneFromStore(f.path));
        continue;
      }
      const full = safeTarget(dir, f.path);
      if (!full) {
        missing.push(`${f.path} (a symbolic link is in the way, so it was not written)`);
        continue;
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, buf);
      chmodSync(full, f.mode & 0o777); // permission bits only, as restore.ts writes them (Security F5)
      if (f.mtimeMs !== undefined) utimesSync(full, new Date(), new Date(f.mtimeMs));
      written++;
    }
    const manual: string[] = [];
    const plainEnv: Record<string, string> = {};
    const plainNames: string[] = [];
    for (const c of m.config) {
      const plain = c.keys.filter((k) => k.kind === "plain" && k.value !== undefined);
      for (const k of plain) plainEnv[k.name] = k.value ?? "";
      plainNames.push(...plain.map((k) => k.name));
      if (plain.length) {
        const full = safeTarget(dir, c.file);
        if (full) {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, plain.map((k) => `${k.name}=${k.value ?? ""}`).join("\n") + "\n");
        } else {
          manual.push(`Write ${c.file} by hand: a symbolic link is in the way, so Time Machine did not write through it`);
        }
      }
      for (const k of c.keys.filter((k) => k.kind === "secret")) manual.push(`Set ${k.name} in ${c.file}`);
    }
    // A folder's save point keeps every file as a saved file; its commit is only an empty tree.
    const restored = p.kind === "folder" ? [] : [`Code at commit ${short(m.git.snapshot)}`];
    if (written) restored.push(plural(written, "saved file"));
    if (plainNames.length) restored.push(`Config: ${plainNames.join(", ")}`);
    // Lockfiles and environment definition files count as restored only when the copy holds the exact recorded bytes.
    const lost = new Set(gone);
    const matching = (list: { path: string; sha256: string }[]): string[] => list.filter((d) => {
      if (lost.has(d.path)) return false;
      const full = join(dir, d.path);
      try {
        if (!lstatSync(full).isFile() || sha256(readFileSync(full)) !== d.sha256) return false;
      } catch {
        return false;
      }
      return true;
    }).map((d) => d.path);
    const lockfiles = matching(m.environment.lockfiles);
    if (lockfiles.length) restored.push(`Dependencies: ${lockfiles.join(", ")}`);
    const definitions = matching(m.environment.definitions);
    if (definitions.length) restored.push(`Environment definition: ${definitions.join(", ")}`);
    return { dir, restored, missing, gone, manual, plainEnv };
  } catch (e) {
    removeWorktree(p, dir);
    throw e;
  }
}
