import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { audit } from "./audit.js";
import { NOT_CAPTURED, summarize } from "./checkpoint.js";
import { checkpoint, describeSummary } from "./folder.js";
import { TmError } from "./errors.js";
import type { Manifest } from "./manifest.js";
import { git, gitTry, short, splitZ } from "./git.js";
import { checkRef, materialize, type Materialized } from "./materialize.js";
import { isInside } from "./paths.js";
import { resolveProject, type Project } from "./project.js";
import { ensureStore, readManifest, sha256, stamp } from "./store.js";
import type { Ctx, RecoverResult, UndoRecoverResult } from "./types.js";
import { latestVerdicts } from "./verdicts.js";
import { z } from "zod";

export const RECOVERY_SUMMARY = "Restored: code, captured files, config. Not restored: database, deployed version, secret values.";
const NO_BRANCH = "No branch was made: this is a plain folder with no Git repository, so the save point came back as a copy only.";
/** The plain recovery copies a folder project's recoveries made, so undo removes only one of them. */
const COPIES_FILE = "recovery-copies.json";
const CopiesSchema = z.strictObject({ version: z.literal(1), copies: z.array(z.strictObject({ id: z.string(), dir: z.string() })) });
type Copies = z.infer<typeof CopiesSchema>["copies"];

function readCopies(p: Project): Copies {
  try {
    return CopiesSchema.parse(JSON.parse(readFileSync(join(p.store, COPIES_FILE), "utf8"))).copies;
  } catch {
    return []; // None yet, or damaged: then no copy counts as ours, so undo leaves every folder alone.
  }
}

function writeCopies(p: Project, copies: Copies): void {
  const path = join(p.store, COPIES_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, copies }, null, 2) + "\n", { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

function freeBranch(p: Project, base: string): string {
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (gitTry(p.root, p.env, ["show-ref", "--verify", "-q", `refs/heads/${name}`]).code !== 0) return name;
  }
}

/** The first free copy name. Anything at a name counts as taken, a dangling symbolic link too. */
function freeDir(base: string): string {
  for (let i = 1; ; i++) {
    const dir = i === 1 ? base : `${base}-${i}`;
    if (!lstatSync(dir, { throwIfNoEntry: false })) return dir;
  }
}

/**
 * Prepares a recovery: saves the current state first, creates a local branch at the
 * checkpoint, and builds a recovery copy next to the project, or inside `dest` when given. It never
 * switches the user's branch, never touches their folder, and never pushes, merges or deploys.
 * A plain folder has no repository, so there is no branch: the recovery is the copy only. A plain
 * folder that was moved or deleted still recovers from the store; there is nothing to save first.
 */
export async function recover(ctx: Ctx, id: string, opts: { dest?: string } = {}): Promise<RecoverResult> {
  const p = resolveProject(ctx);
  ensureStore(p);
  const m = readManifest(p, id);
  checkRef(p, m);
  const folder = p.kind === "folder";
  let parent = dirname(p.root);
  if (opts.dest !== undefined) {
    parent = resolve(ctx.cwd, opts.dest);
    const st = statSync(parent, { throwIfNoEntry: false });
    if (!st) throw new TmError("usage", `${parent} does not exist. Pick a folder that exists for the recovery copy.`);
    if (!st.isDirectory()) throw new TmError("usage", `${parent} is a file, not a folder. Pick a folder for the recovery copy.`);
    if (isInside(p.root, parent)) throw new TmError("usage", `${parent} is inside the project. Pick a folder outside it, so your working copy stays untouched.`);
  }

  const saved = p.missing ? null : await checkpoint(ctx, { note: `Before recovering ${id}`, trigger: "recover" });
  const branch = folder ? "" : freeBranch(p, `tm/recover/${id}`);
  if (!folder) git(p.root, p.env, ["branch", branch, m.git.snapshot]);
  const copyDir = freeDir(join(parent, `${basename(p.root)}-recovered-${id}`));
  let r: Materialized;
  try {
    // A folder's copy is plain files, with no .git linking it to the store.
    r = materialize(p, m, copyDir, folder ? { plain: true } : { branch });
  } catch (e) {
    if (folder) throw e;
    // The copy could not be built and materialize already removed it. Remove the branch this
    // attempt made too, only while no worktree has it and it still points where it was made.
    // Best effort: if Git cannot list worktrees, the branch stays and the reason the copy failed is reported.
    try {
      gitTry(p.root, p.env, ["worktree", "prune"]);
      if (!worktrees(p).some((w) => w.branch === `refs/heads/${branch}`)) gitTry(p.root, p.env, ["update-ref", "-d", `refs/heads/${branch}`, m.git.snapshot]);
    } catch {
      // keep the original error
    }
    throw e;
  }

  const last = latestVerdicts(p).get(id) ?? null;
  // Everything the save point could not bring back: secret values, edits and files kept out
  // because they looked secret, ignored folders, and anything missing from the store.
  const secretLines = m.coverage.manual.filter((x) => x.startsWith("Secret values"));
  const otherManual = m.coverage.manual.filter((x) => !x.startsWith("Secret values") && x !== NOT_CAPTURED);
  const notRestored = [...secretLines, ...otherManual, ...describeSummary(p, summarize(m)).coverage.missing, ...r.missing, NOT_CAPTURED];
  if (!secretLines.length) notRestored.unshift("Secret values: none were recorded");
  const manualSteps = [
    ...(folder ? [NO_BRANCH] : []),
    ...r.manual.map((s) => `${s} in the recovery copy.`),
    ...r.gone.map((f) => `Recreate ${f} by hand.`),
    `Review the recovery copy at ${copyDir}.`,
    folder
      ? p.missing ? "Copy the files you want into place. The folder was not there, so nothing else was touched." : "Copy back the files you want to keep. Your folder was not touched."
      : "Keep working in the recovery copy. Review and commit the restored files you want to keep before moving or removing it.",
  ];

  const lastLine = last ? `Last check: ${last.verdict} (${last.isolation} mode) at ${last.at}.` : "Last check: not checked yet. Run tm verify before you rely on it.";
  const report = [
    `# Recovery report: ${id}`,
    "",
    `Created ${new Date().toISOString()} from "${m.note}" (${m.createdAt}).`,
    p.missing ? "Nothing was pushed, merged or deployed." : "Nothing was pushed, merged or deployed. Your current folder and branch were not touched.",
    saved
      ? `Before this recovery, your current state was saved as ${saved.checkpoint.id}, so you can come back to it.`
      : `${p.root} was not there, so there was nothing to save before this recovery.`,
    "",
    folder ? NO_BRANCH : `Branch: ${branch} at commit ${short(m.git.snapshot)}`,
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
  writeFileSync(reportPath, report, { mode: 0o600 });
  audit(p, "recover", id, folder ? `copy ${copyDir}` : `branch ${branch}`);
  if (folder) writeCopies(p, [...readCopies(p), { id, dir: real(copyDir) }]);

  return {
    id,
    branch,
    copyDir,
    savedBefore: saved?.checkpoint.id ?? null,
    reportPath,
    lastVerdict: last?.verdict ?? null,
    restored: r.restored,
    notRestored,
    manualSteps,
    missing: r.missing,
    pushed: false,
    ...(folder ? { copyOnly: true as const } : {}),
  };
}

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Every worktree of the project, the branch it has checked out and its HEAD commit. */
function worktrees(p: Project): { dir: string; branch: string | null; head: string | null }[] {
  const out: { dir: string; branch: string | null; head: string | null }[] = [];
  for (const field of splitZ(git(p.root, p.env, ["worktree", "list", "--porcelain", "-z"]))) {
    const last = out.at(-1);
    if (field.startsWith("worktree ")) out.push({ dir: real(field.slice(9)), branch: null, head: null });
    else if (field.startsWith("branch ") && last) last.branch = field.slice(7);
    else if (field.startsWith("HEAD ") && last) last.head = field.slice(5);
  }
  return out;
}

/** Each file a recovery wrote and its hash: the saved files, and a config file rewritten with its plain values. */
function writtenFiles(m: Manifest): Map<string, string> {
  const written = new Map(m.files.map((f) => [f.path, f.sha256]));
  for (const c of m.config) {
    const plain = c.keys.filter((k) => k.kind === "plain" && k.value !== undefined);
    if (plain.length) written.set(c.file, sha256(plain.map((k) => `${k.name}=${k.value ?? ""}`).join("\n") + "\n"));
  }
  return written;
}

/** Paths in the recovery copy that differ from what the recovery wrote there. */
function changesInCopy(p: Project, copyDir: string, m: Manifest): string[] {
  const written = writtenFiles(m);
  // Raw output: trimming would eat the leading space of the first " M path" entry.
  const st = gitTry(copyDir, p.env, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"]);
  if (st.code !== 0) throw new TmError("internal", `git status failed: ${st.stderr.trim()}`);
  const fields = splitZ(st.stdout);
  const changed: string[] = [];
  // Ignored files (an install, a build) are named by their top folder, first, not one by one.
  const ignoredDirs: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] ?? "";
    const xy = f.slice(0, 2);
    const path = f.slice(3);
    if (/[RC]/.test(xy)) i++; // a rename or copy carries its old path next
    // Files Time Machine wrote, including a tracked config file it rewrote with the plain values.
    if (xy === "??" || xy === "!!" || xy === " M") {
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
 * recovery made first. A plain folder's recovery made no branch, so `branch` is "" and only its copy goes.
 */
export async function undoRecover(ctx: Ctx, opts: { id: string; branch: string; copyDir: string }): Promise<UndoRecoverResult> {
  const p = resolveProject(ctx);
  const m = readManifest(p, opts.id);
  const { branch, copyDir } = opts;
  const escaped = opts.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (p.kind === "folder") return undoFolderRecover(p, m, opts.id, branch, copyDir, escaped);
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
  // A copy the person already deleted by hand has no work left in it: Git only still lists it.
  const removeCopy = copy !== undefined && existsSync(copyDir);
  if (removeCopy) {
    const changed = changesInCopy(p, copyDir, m);
    if (changed.length) {
      const shown = changed.slice(0, 3).join(", ") + (changed.length > 3 ? ` and ${changed.length - 3} more` : "");
      throw new TmError("usage", `The recovery copy has changes (${shown}), so it was left alone. Move your work out of it first.`);
    }
    git(p.root, p.env, ["worktree", "remove", "--force", copyDir]);
  }
  gitTry(p.root, p.env, ["worktree", "prune"]);
  git(p.root, p.env, ["branch", "-D", branch]);
  audit(p, "undo-recover", opts.id, `removed branch ${branch}${removeCopy ? " and its recovery copy" : ""}`);
  return { id: opts.id, removedBranch: branch, removedCopy: removeCopy ? copyDir : null };
}

/** Removes a plain folder's recovery copy: plain files this recovery recorded, named for this save point, still as it was made. */
function undoFolderRecover(p: Project, m: Manifest, id: string, branch: string, copyDir: string, escaped: string): UndoRecoverResult {
  if (branch !== "") throw new TmError("usage", `${p.name} is a plain folder, so its recovery made no branch. ${branch} was left alone.`);
  const dir = real(copyDir);
  // Named for this save point and recorded when it was made: the copy may sit next to the folder or in a folder the person picked.
  const named = new RegExp(`^${basename(p.root).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-recovered-${escaped}(-\\d+)?$`).test(basename(dir));
  const copies = readCopies(p);
  if (!named || !copies.some((c) => c.id === id && c.dir === dir)) throw new TmError("usage", `${copyDir} is not the recovery copy for ${id}, so it was left alone.`);
  const rest = copies.filter((c) => !(c.id === id && c.dir === dir));
  if (!existsSync(dir)) {
    writeCopies(p, rest);
    throw new TmError("not_found", `The recovery copy ${copyDir} is already gone.`);
  }
  const changed = changesInPlainCopy(dir, m);
  if (changed.length) {
    const shown = changed.slice(0, 3).join(", ") + (changed.length > 3 ? ` and ${changed.length - 3} more` : "");
    throw new TmError("usage", `The recovery copy has changes (${shown}), so it was left alone. Move your work out of it first.`);
  }
  rmSync(dir, { recursive: true, force: true });
  writeCopies(p, rest);
  audit(p, "undo-recover", id, "removed its recovery copy");
  return { id, removedBranch: "", removedCopy: copyDir };
}

/** Paths in a plain recovery copy that are new or differ from what the recovery wrote. Deleted files lose no work, so they do not count. */
function changesInPlainCopy(dir: string, m: Manifest): string[] {
  const written = writtenFiles(m);
  const changed: string[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, path));
      if (st.isDirectory()) walk(path);
      else if (!st.isFile() || written.get(path) !== sha256(readFileSync(join(dir, path)))) changed.push(path);
    }
  };
  walk("");
  return changed;
}
