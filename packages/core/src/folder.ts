// Plain folder projects. A folder outside any Git repository keeps its history in a shadow Git dir in
// the store (see project.ts). Every save point of a folder is an empty Git tree plus each file saved
// as a blob, so the same secret screening and size cap apply to every file. Nothing is written in the folder.
import { checkpoint as saveCheckpoint, type CheckpointOptions } from "./checkpoint.js";
import { TmError } from "./errors.js";
import { hookInstall as installHooks } from "./hooks.js";
import { resolveProject, type Project, type ProjectKind } from "./project.js";
import type { CheckpointResult, CheckpointSummary, Ctx, HookInstallResult } from "./types.js";

/**
 * Adds the project at ctx.cwd: the Git repository around it, or else the folder itself as a plain
 * folder project. Returns its root and kind. Writes only in the store, and with dryRun not at all.
 */
export function protect(ctx: Ctx, opts: { dryRun?: boolean } = {}): { root: string; kind: ProjectKind } {
  const p = resolveProject(ctx, { create: opts.dryRun ? "plan" : "write" });
  return { root: p.root, kind: p.kind };
}

/** A folder's save point in folder words: no commit or "Code" line, and its files are in the folder, not "not in Git". */
export function folderSummary<T extends CheckpointSummary>(p: Project, s: T): T {
  if (p.kind !== "folder") return s;
  const captured = s.coverage.captured.filter((x) => !x.startsWith("Code: ")).map((x) => x.replace(/^Files: (.+) not in Git$/, "Files: $1 in the folder"));
  const restorable = s.coverage.restorable.filter((x) => x !== "Code");
  return { ...s, dirty: false, coverage: { ...s.coverage, captured, restorable } };
}

/** Saves a checkpoint (checkpoint.ts) and describes a folder's save point in folder words. */
export async function checkpoint(ctx: Ctx, opts: CheckpointOptions = {}): Promise<CheckpointResult> {
  const r = await saveCheckpoint(ctx, opts);
  return { ...r, checkpoint: folderSummary(resolveProject(ctx), r.checkpoint) };
}

/** Adds the Claude Code hook lines (hooks.ts), never in a plain folder: they would be a file written in it. */
export async function hookInstall(ctx: Ctx, opts: { command: string }): Promise<HookInstallResult> {
  if (resolveProject(ctx).kind === "folder") {
    throw new TmError("usage", "This is a plain folder, so Claude Code hook lines were not added. They would write .claude/settings.json into the folder, and Time Machine never writes in a plain folder.");
  }
  return installHooks(ctx, opts);
}
