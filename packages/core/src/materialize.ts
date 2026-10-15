import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TmError } from "./errors.js";
import { git, gitTry, short } from "./git.js";
import type { Manifest } from "./manifest.js";
import type { Project } from "./project.js";
import { getBlob } from "./store.js";

export interface Materialized {
  dir: string;
  restored: string[];
  missing: string[];
  manual: string[];
  plainEnv: Record<string, string>;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The pinned ref must still point at the commit the manifest recorded. */
export function checkRef(p: Project, m: Manifest): void {
  const r = gitTry(p.root, p.env, ["rev-parse", "--verify", "-q", `refs/tm/${m.id}^{commit}`]);
  if (r.code !== 0) throw new TmError("not_found", `The Git commit for ${m.id} is missing from this repository.`);
  if (r.stdout.trim() !== m.git.snapshot) throw new TmError("integrity", `${m.id} failed its integrity check. Its Git ref was moved.`);
}

export function removeWorktree(p: Project, dir: string): void {
  gitTry(p.root, p.env, ["worktree", "remove", "--force", dir]);
  rmSync(dir, { recursive: true, force: true });
  gitTry(p.root, p.env, ["worktree", "prune"]);
}

/**
 * Rebuilds a checkpoint in a separate Git worktree. The user's working copy,
 * index and current branch are never touched.
 */
export function materialize(p: Project, m: Manifest, dir: string, opts: { branch?: string } = {}): Materialized {
  checkRef(p, m);
  if (existsSync(dir)) throw new TmError("usage", `${dir} already exists. Pick another folder.`);
  mkdirSync(dirname(dir), { recursive: true });
  const args = opts.branch ? ["worktree", "add", "-q", dir, opts.branch] : ["worktree", "add", "-q", "--detach", dir, m.git.snapshot];
  git(p.root, p.env, args);
  try {
    const missing: string[] = [];
    let written = 0;
    for (const f of m.files) {
      const buf = getBlob(p, f.sha256, f.path);
      if (!buf) {
        missing.push(f.path);
        continue;
      }
      const full = join(dir, f.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, buf);
      chmodSync(full, f.mode);
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
        const full = join(dir, c.file);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, plain.map((k) => `${k.name}=${k.value ?? ""}`).join("\n") + "\n");
      }
      for (const k of c.keys.filter((k) => k.kind === "secret")) manual.push(`Set ${k.name} in ${c.file}`);
    }
    const restored = [`Code at commit ${short(m.git.snapshot)}`];
    if (written) restored.push(plural(written, "saved file"));
    if (plainNames.length) restored.push(`Config: ${plainNames.join(", ")}`);
    return { dir, restored, missing, manual, plainEnv };
  } catch (e) {
    removeWorktree(p, dir);
    throw e;
  }
}
