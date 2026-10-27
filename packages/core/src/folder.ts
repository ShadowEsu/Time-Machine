// Plain folder projects. A folder outside any Git repository keeps its history in a shadow Git dir in
// the store (see project.ts). Every save point of a folder is an empty Git tree plus each file saved
// as a blob, so the same secret screening and size cap apply to every file. Nothing is written in the folder.
import { join } from "node:path";
import { checkpoint as saveCheckpoint, type CheckpointOptions } from "./checkpoint.js";
import { CONFIG_FILE } from "./config.js";
import { TmError } from "./errors.js";
import { gitTry } from "./git.js";
import { hookInstall as installHooks } from "./hooks.js";
import { assertOwnGitDir, configRoot, resolveProject, type Project, type ProjectKind } from "./project.js";
import type { CheckpointResult, CheckpointSummary, Ctx, HookInstallResult } from "./types.js";

/**
 * Adds the project at ctx.cwd: the Git repository around it, or else the folder itself as a plain
 * folder project. Returns its root and kind. Writes only in the store, and with dryRun not at all.
 */
export function protect(ctx: Ctx, opts: { dryRun?: boolean } = {}): { root: string; kind: ProjectKind } {
  const p = resolveProject(ctx, { create: opts.dryRun ? "plan" : "write" });
  return { root: p.root, kind: p.kind };
}

/** The sentence for a project whose folder is not on disk any more. */
export function missingFolder(p: Project): string {
  return `${p.root} is not there any more, so nothing was saved. Its save points are safe in the store: run tm timeline to see them, tm recover <id> --to <folder> to bring one back, or tm relink ${p.root} <new path> if it moved.`;
}

/**
 * A save point in the words a person reads. Every kind: a file over the size cap names the setting and
 * the file it lives in. A folder: no commit or "Code" line, and its files are in the folder, not "not in Git".
 */
export function describeSummary<T extends CheckpointSummary>(p: Project, s: T): T {
  const configPath = join(configRoot(p), CONFIG_FILE);
  const missing = s.coverage.missing.map((x) => x.replace(/^(.+) is over the (\d+(?:\.\d+)?) MB limit$/, `$1: over the $2 MB limit (capture.maxFileMB in ${configPath})`));
  if (p.kind !== "folder") return { ...s, coverage: { ...s.coverage, missing } };
  const captured = s.coverage.captured.filter((x) => !x.startsWith("Code: ")).map((x) => x.replace(/^Files: (.+) not in Git$/, "Files: $1 in the folder"));
  const restorable = s.coverage.restorable.filter((x) => x !== "Code");
  return { ...s, dirty: false, coverage: { ...s.coverage, captured, restorable, missing } };
}

/** Folders a save could not look into, as "<rel>: could not be read". Git skips them with only a warning. */
function unreadableFolders(p: Project): string[] {
  const r = gitTry(p.root, p.env, ["ls-files", "-z", "--others", "--exclude-standard"]);
  return [...r.stderr.matchAll(/could not open directory '(.+?)\/?': /g)].map((m) => `${m[1]}: could not be read`);
}

/**
 * Saves a checkpoint (checkpoint.ts) and describes it in plain words. Refuses a folder that is gone and a
 * Git repository another project already protects. A folder the save could not read is listed in Not saved.
 */
export async function checkpoint(ctx: Ctx, opts: CheckpointOptions = {}): Promise<CheckpointResult> {
  const p = resolveProject(ctx);
  if (p.missing) throw new TmError("not_found", missingFolder(p));
  assertOwnGitDir(p);
  const r = await saveCheckpoint(ctx, opts);
  const s = describeSummary(p, r.checkpoint);
  const unread = unreadableFolders(p).filter((x) => !s.coverage.missing.includes(x));
  return { ...r, kind: p.kind, checkpoint: unread.length ? { ...s, coverage: { ...s.coverage, missing: [...unread, ...s.coverage.missing] } } : s };
}

/** Adds the Claude Code hook lines (hooks.ts), never in a plain folder: they would be a file written in it. */
export async function hookInstall(ctx: Ctx, opts: { command: string }): Promise<HookInstallResult> {
  if (resolveProject(ctx).kind === "folder") {
    throw new TmError("usage", "This is a plain folder, so Claude Code hook lines were not added. They would write .claude/settings.json into the folder, and Time Machine never writes in a plain folder.");
  }
  return installHooks(ctx, opts);
}
