import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { audit } from "./audit.js";
import { checkpoint, NOT_CAPTURED } from "./checkpoint.js";
import { TmError } from "./errors.js";
import type { Manifest } from "./manifest.js";
import { git, gitTry, short, splitZ } from "./git.js";
import { checkRef, materialize } from "./materialize.js";
import { resolveProject, type Project } from "./project.js";
import { ensureStore, readManifest, sha256, stamp } from "./store.js";
import type { Ctx, RecoverResult, UndoRecoverResult } from "./types.js";
import { latestVerdicts } from "./verdicts.js";

export const RECOVERY_SUMMARY = "Restored: code, captured files, config. Not restored: database, deployed version, secret values.";

function freeBranch(p: Project, base: string): string {
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (gitTry(p.root, p.env, ["show-ref", "--verify", "-q", `refs/heads/${name}`]).code !== 0) return name;
  }
}

function freeDir(base: string): string {
  for (let i = 1; ; i++) {
    const dir = i === 1 ? base : `${base}-${i}`;
    if (!existsSync(dir)) return dir;
  }
}

/**
 * Prepares a recovery: saves the current state first, creates a local branch at the
 * checkpoint, and builds a recovery copy next to the project. It never switches the
 * user's branch, never touches their folder, and never pushes, merges or deploys.
 */
export async function recover(ctx: Ctx, id: string): Promise<RecoverResult> {
  const p = resolveProject(ctx);
  ensureStore(p);
  const m = readManifest(p, id);
  checkRef(p, m);

  const saved = await checkpoint(ctx, { note: `Before recovering ${id}`, trigger: "recover" });
  const branch = freeBranch(p, `tm/recover/${id}`);
  git(p.root, p.env, ["branch", branch, m.git.snapshot]);
  const copyDir = freeDir(join(dirname(p.root), `${basename(p.root)}-recovered-${id}`));
  const r = materialize(p, m, copyDir, { branch });

  const last = latestVerdicts(p).get(id) ?? null;
  const secretLines = m.coverage.manual.filter((x) => x.startsWith("Secret values"));
  const notRestored = [...secretLines, ...m.coverage.manual.filter((x) => x.includes("looks like it contains a secret")), ...m.coverage.missing, ...r.missing.map((f) => `${f} (its saved copy is missing)`), NOT_CAPTURED];
  if (!secretLines.length) notRestored.unshift("Secret values: none were recorded");
  const manualSteps = [
    ...r.manual.map((s) => `${s} in the recovery copy.`),
    ...r.missing.map((f) => `Recreate ${f} by hand.`),
    `Review the recovery copy at ${copyDir}.`,
    `To use it in your main folder: git worktree remove "${copyDir}", then git switch ${branch}`,
  ];

  const lastLine = last ? `Last check: ${last.verdict} (${last.isolation} mode) at ${last.at}.` : "Last check: not checked yet. Run tm verify before you rely on it.";
  const report = [
    `# Recovery report: ${id}`,
    "",
    `Created ${new Date().toISOString()} from "${m.note}" (${m.createdAt}).`,
    "Nothing was pushed, merged or deployed. Your current folder and branch were not touched.",
    `Before this recovery, your current state was saved as ${saved.checkpoint.id}, so you can come back to it.`,
    "",
    `Branch: ${branch} at commit ${short(m.git.snapshot)}`,
    `Recovery copy: ${copyDir}`,
    lastLine,
    "",
    "## Restored",
    ...r.restored.map((x) => `- ${x}`),
    "",
    "## Not restored",
    ...notRestored.map((x) => `- ${x}`),
    "",
    "## Manual steps",
    ...manualSteps.map((x, i) => `${i + 1}. ${x}`),
    "",
    RECOVERY_SUMMARY,
    "",
  ].join("\n");
  const reportPath = join(p.store, "reports", `recover-${id}-${stamp()}.md`);
  writeFileSync(reportPath, report);
  audit(p, "recover", id, `branch ${branch}`);

  return {
    id,
    branch,
    copyDir,
    savedBefore: saved.checkpoint.id,
    reportPath,
    lastVerdict: last?.verdict ?? null,
    restored: r.restored,
    notRestored,
    manualSteps,
    pushed: false,
  };
}

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Every worktree of the project and the branch it has checked out. */
function worktrees(p: Project): { dir: string; branch: string | null }[] {
  const out: { dir: string; branch: string | null }[] = [];
  for (const field of splitZ(git(p.root, p.env, ["worktree", "list", "--porcelain", "-z"]))) {
    if (field.startsWith("worktree ")) out.push({ dir: real(field.slice(9)), branch: null });
    else if (field.startsWith("branch ")) {
      const last = out.at(-1);
      if (last) last.branch = field.slice(7);
    }
  }
  return out;
}

/** Paths in the recovery copy that differ from what the recovery wrote there. */
function changesInCopy(p: Project, copyDir: string, m: Manifest): string[] {
  const written = new Map(m.files.map((f) => [f.path, f.sha256]));
  for (const c of m.config) {
    const plain = c.keys.filter((k) => k.kind === "plain" && k.value !== undefined);
    if (plain.length) written.set(c.file, sha256(plain.map((k) => `${k.name}=${k.value ?? ""}`).join("\n") + "\n"));
  }
  const fields = splitZ(git(copyDir, p.env, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"]));
  const changed: string[] = [];
  // Ignored files (an install, a build) are named by their top folder, first, not one by one.
  const ignoredDirs: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] ?? "";
    const xy = f.slice(0, 2);
    const path = f.slice(3);
    if (/[RC]/.test(xy)) i++; // a rename or copy carries its old path next
    if (xy === "??" || xy === "!!") {
      const want = written.get(path);
      try {
        if (want && sha256(readFileSync(join(copyDir, path))) === want) continue;
      } catch {
        // unreadable: count it as a change
      }
    }
    const dir = xy === "!!" && path.includes("/") ? `${path.split("/")[0] ?? path}/ (ignored by Git, like installed dependencies or build output)` : null;
    if (!dir) changed.push(path);
    else if (!ignoredDirs.includes(dir)) ignoredDirs.push(dir);
  }
  return [...ignoredDirs, ...changed];
}

/**
 * Undoes a recovery: removes the recovery branch and the recovery copy it made. Only while
 * both are exactly as the recovery left them, so no new work is ever lost. It never touches
 * the project folder or its branch, and never removes a save point, including the one the
 * recovery made first.
 */
export async function undoRecover(ctx: Ctx, opts: { id: string; branch: string; copyDir: string }): Promise<UndoRecoverResult> {
  const p = resolveProject(ctx);
  const m = readManifest(p, opts.id);
  const { branch, copyDir } = opts;
  const escaped = opts.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^tm/recover/${escaped}(-\\d+)?$`).test(branch)) {
    throw new TmError("usage", `${branch} is not a recovery branch for ${opts.id}, so it was left alone.`);
  }
  const tip = gitTry(p.root, p.env, ["rev-parse", "--verify", "-q", `refs/heads/${branch}^{commit}`]);
  if (tip.code !== 0) throw new TmError("not_found", `There is no branch ${branch}. It may already be gone.`);
  if (tip.stdout.trim() !== m.git.snapshot) {
    throw new TmError("usage", `${branch} has new commits since the recovery, so it was left alone. Delete it yourself if you are sure.`);
  }
  const trees = worktrees(p);
  const ref = `refs/heads/${branch}`;
  if (trees.some((w) => w.dir === real(p.root) && w.branch === ref)) {
    throw new TmError("usage", `Your project folder is on ${branch} now. Undo never switches your folder, so switch away from it first.`);
  }
  const copy = trees.find((w) => w.dir === real(copyDir));
  if (copy && copy.branch !== ref) throw new TmError("usage", `${copyDir} is not the recovery copy for ${branch}, so it was left alone.`);
  if (!copy && existsSync(copyDir)) throw new TmError("usage", `${copyDir} is not a recovery copy Time Machine made, so it was left alone.`);
  if (copy) {
    const changed = changesInCopy(p, copyDir, m);
    if (changed.length) {
      const shown = changed.slice(0, 3).join(", ") + (changed.length > 3 ? ` and ${changed.length - 3} more` : "");
      throw new TmError("usage", `The recovery copy has changes (${shown}), so it was left alone. Move your work out of it first.`);
    }
    git(p.root, p.env, ["worktree", "remove", "--force", copyDir]);
  }
  gitTry(p.root, p.env, ["worktree", "prune"]);
  git(p.root, p.env, ["branch", "-D", branch]);
  audit(p, "undo-recover", opts.id, `removed branch ${branch}${copy ? " and its recovery copy" : ""}`);
  return { id: opts.id, removedBranch: branch, removedCopy: copy ? copyDir : null };
}
