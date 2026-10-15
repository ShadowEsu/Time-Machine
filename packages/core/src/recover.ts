import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { audit } from "./audit.js";
import { checkpoint, NOT_CAPTURED } from "./checkpoint.js";
import { git, gitTry, short } from "./git.js";
import { checkRef, materialize } from "./materialize.js";
import { resolveProject, type Project } from "./project.js";
import { ensureStore, readManifest, stamp } from "./store.js";
import type { Ctx, RecoverResult } from "./types.js";
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
