import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "./audit.js";
import { loadConfig, LOCKFILES, VERSION_PINS, type ProjectConfig } from "./config.js";
import { git, gitTry, safeRemote, short, splitZ } from "./git.js";
import type { Manifest } from "./manifest.js";
import { runSync } from "./exec.js";
import { resolveProject, type Project } from "./project.js";
import { clipSafe, fingerprint, isSecretFileName, looksSecret, parseDotenv } from "./secrets.js";
import { ensureStore, listIds, nextNumber, putBlob, readManifest, sha256, storeKey, withLock, writeManifest } from "./store.js";
import type { AgentInfo, CheckpointResult, CheckpointSummary, Ctx } from "./types.js";

export const NOT_CAPTURED = "Databases, deployed versions and external services are not captured";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function summarize(m: Manifest): CheckpointSummary {
  return {
    id: m.id,
    createdAt: m.createdAt,
    note: m.note,
    trigger: m.trigger,
    agent: m.agent ?? null,
    commit: m.git.snapshot,
    head: m.git.head,
    branch: m.git.branch,
    dirty: m.git.dirty,
    files: m.files.length,
    coverage: m.coverage,
  };
}

/**
 * The agent behind a trigger. The app, the CLI and Time Machine itself are a person, so they have none.
 * Claude Code is never derived from a trigger: only the hooks name it, by passing the agent.
 */
export function agentFromTrigger(trigger: string): AgentInfo | null {
  if (trigger === "mcp") return { name: "MCP agent" };
  return null;
}

/** The agent to record: the caller's, else the one the trigger names. Names and prompts are clipped and secret safe. */
function agentFor(trigger: string, given: AgentInfo | undefined): AgentInfo | undefined {
  const a = given ?? agentFromTrigger(trigger);
  if (!a) return undefined;
  const prompt = a.prompt === undefined ? "" : clipSafe(a.prompt, 120);
  return { name: clipSafe(a.name, 60, "Agent"), ...(prompt ? { prompt } : {}) };
}

/** Records the tracked working tree as a commit without touching the user's index, HEAD or branch. */
function containsSecret(path: string, buf: Buffer): boolean {
  return isSecretFileName(path) || looksSecret(buf.toString("latin1"));
}

function snapshotCommit(p: Project, cfg: ProjectConfig, id: string, head: string | null): { snapshot: string; tree: string; changedTracked: number; secretTracked: string[] } {
  const tmp = mkdtempSync(join(tmpdir(), "tm-index-"));
  const index = { GIT_INDEX_FILE: join(tmp, "index") };
  try {
    git(p.root, p.env, head ? ["read-tree", head] : ["read-tree", "--empty"], index);
    const pathspec = ["--", ".", ...cfg.config.files.map((f) => `:(exclude)${f}`)];
    // With nothing tracked yet (no first commit, or an empty one), git add -u fails on the unmatched pathspec.
    if (splitZ(git(p.root, p.env, ["ls-files", "-z", ...pathspec], index)).length) git(p.root, p.env, ["add", "-u", ...pathspec], index);
    // Edited tracked files that now hold a secret keep their last committed version.
    const changedPaths = head ? splitZ(git(p.root, p.env, ["diff-index", "--cached", "-z", "--name-only", head], index)) : splitZ(git(p.root, p.env, ["ls-files", "-z"], index));
    const secretTracked = changedPaths.filter((rel) => {
      const full = join(p.root, rel);
      try {
        return lstatSync(full).isFile() && containsSecret(rel, readFileSync(full));
      } catch {
        return false;
      }
    });
    if (secretTracked.length) {
      git(p.root, p.env, head ? ["reset", "-q", head, "--", ...secretTracked] : ["rm", "-q", "--cached", "--", ...secretTracked], index);
    }
    const tree = git(p.root, p.env, ["write-tree"], index);
    const headTree = head ? git(p.root, p.env, ["rev-parse", `${head}^{tree}`]) : null;
    if (head && tree === headTree) return { snapshot: head, tree, changedTracked: 0, secretTracked };
    const changed = head
      ? splitZ(git(p.root, p.env, ["diff-tree", "-r", "-z", "--name-only", headTree ?? head, tree])).length
      : splitZ(git(p.root, p.env, ["ls-files", "-z"], index)).length;
    const args = ["commit-tree", tree, "--no-gpg-sign", "-m", `Time Machine save point ${id}`];
    if (head) args.push("-p", head);
    return { snapshot: git(p.root, p.env, args), tree, changedTracked: changed, secretTracked };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function untrackedCandidates(p: Project, cfg: ProjectConfig, head: string | null): string[] {
  const inHead = new Set(head ? splitZ(git(p.root, p.env, ["ls-tree", "-r", "-z", "--name-only", head])) : []);
  const staged = splitZ(git(p.root, p.env, ["ls-files", "-z"])).filter((f) => !inHead.has(f));
  const others = cfg.capture.untracked ? splitZ(git(p.root, p.env, ["ls-files", "-z", "--others", "--exclude-standard"])) : [];
  const included = cfg.capture.include.length
    ? splitZ(git(p.root, p.env, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...cfg.capture.include]))
    : [];
  // Lockfiles and version pins come back even when .gitignore skips them, so a recovery rebuilds the
  // same dependencies and runtime, not just the same code. Other environment files (Dockerfile,
  // compose, devcontainer) can hold secrets in forms the secret scan misses (ENV, ARG, JSON), so
  // when ignored they keep only their digest. Only exact pin names are used: environment.files
  // entries are git pathspecs, and a glob there must never pull in other ignored files.
  const pins = cfg.environment.files.filter((f) => VERSION_PINS.includes(f));
  const environment = splitZ(git(p.root, p.env, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...LOCKFILES, ...pins]));
  const configFiles = new Set(cfg.config.files);
  return [...new Set([...staged, ...others, ...included, ...environment])].filter((f) => !configFiles.has(f)).sort();
}

function runtimeVersions(p: Project): Record<string, string> {
  const out: Record<string, string> = { platform: `${process.platform}-${process.arch}` };
  const node = runSync("node", ["--version"], { cwd: p.root, env: p.env });
  if (node.code === 0) out.node = node.stdout.trim();
  const g = gitTry(p.root, p.env, ["--version"]);
  if (g.code === 0) out.git = g.stdout.trim().replace(/^git version /, "");
  return out;
}

function digests(root: string, paths: string[]): { path: string; sha256: string }[] {
  return paths.filter((f) => existsSync(join(root, f)) && lstatSync(join(root, f)).isFile()).map((f) => ({ path: f, sha256: sha256(readFileSync(join(root, f))) }));
}

/** Same tree on the same HEAD, same saved files, same config. Commit hashes differ by time, so they are not compared. */
function sameState(p: Project, m: Manifest, head: string | null, tree: string, files: Manifest["files"], config: Manifest["config"]): boolean {
  const f = (x: Manifest["files"]): string => JSON.stringify(x.map((y) => [y.path, y.sha256, y.mode]));
  const c = (x: Manifest["config"]): string => JSON.stringify(x.map((y) => [y.file, y.keys.map((k) => [k.name, k.fingerprint])]));
  const prevTree = gitTry(p.root, p.env, ["rev-parse", "-q", "--verify", `${m.git.snapshot}^{tree}`]);
  return prevTree.code === 0 && prevTree.stdout.trim() === tree && m.git.head === head && f(m.files) === f(files) && c(m.config) === c(config);
}

const HIDDEN_NOTE = "(note hidden: it looked like it contained a secret)";

export interface CheckpointOptions {
  note?: string;
  trigger?: string;
  /** The agent that asked for this save point. Without it, the agent is derived from the trigger. */
  agent?: AgentInfo;
  /** Return the newest checkpoint instead of a new one when nothing changed. */
  skipIfUnchanged?: boolean;
}

export async function checkpoint(ctx: Ctx, opts: CheckpointOptions = {}): Promise<CheckpointResult> {
  const p = resolveProject(ctx);
  const { config: cfg } = loadConfig(p.root);
  ensureStore(p);
  return withLock(p, async () => {
    const ids = listIds(p);
    const last = ids.at(-1);

    const headR = gitTry(p.root, p.env, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
    const head = headR.code === 0 ? headR.stdout.trim() : null;
    const branchR = gitTry(p.root, p.env, ["symbolic-ref", "--short", "-q", "HEAD"]);
    const branch = branchR.code === 0 ? branchR.stdout.trim() : null;
    const remoteR = gitTry(p.root, p.env, ["remote", "get-url", "origin"]);
    const remote = remoteR.code === 0 ? safeRemote(remoteR.stdout.trim()) : null;

    const pending = `cp-${String(Number(last?.slice(3) ?? 0) + 1).padStart(4, "0")}`;
    const { snapshot, tree, changedTracked, secretTracked } = snapshotCommit(p, cfg, pending, head);

    const missing: string[] = [];
    const manual: string[] = secretTracked.map((f) => `${f} has uncommitted changes that look like a secret, so its last committed version was saved instead`);
    const files: Manifest["files"] = [];
    const candidates = untrackedCandidates(p, cfg, head);
    const maxBytes = cfg.capture.maxFileMB * 1024 * 1024;
    for (const rel of candidates) {
      const name = rel.replace(/\/$/, "");
      const full = join(p.root, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue; // staged, then deleted on disk
      }
      if (st.isSymbolicLink()) {
        missing.push(`${name} is a symbolic link, so it was not saved`);
        continue;
      }
      if (st.isDirectory()) {
        missing.push(`${name} is a nested Git repository or folder Git skips, so it was not saved`);
        continue;
      }
      if (!st.isFile()) {
        missing.push(`${name} is not a regular file, so it was not saved`);
        continue;
      }
      if (isSecretFileName(name)) {
        manual.push(`${name} is a secrets file by name, so it was not saved`);
        continue;
      }
      if (st.size > maxBytes) {
        missing.push(`${rel} is over the ${cfg.capture.maxFileMB} MB limit`);
        continue;
      }
      const buf = readFileSync(full);
      if (looksSecret(buf.toString("latin1"))) {
        manual.push(`${name} looks like it contains a secret, so it was not saved`);
        continue;
      }
      files.push({ path: name, sha256: putBlob(p, buf), size: st.size, mode: st.mode & 0o777 });
    }

    const key = storeKey(p);
    const config: Manifest["config"] = [];
    for (const file of cfg.config.files) {
      const full = join(p.root, file);
      if (!existsSync(full) && !isLink(full)) continue;
      if (!lstatSync(full).isFile()) {
        missing.push(`${file} is not a regular file, so its keys were not recorded`);
        continue;
      }
      const keys = parseDotenv(readFileSync(full, "utf8")).map(({ name, value }) => {
        const fp = fingerprint(key, name, value);
        return cfg.config.plain.includes(name) && !looksSecret(value)
          ? { name, kind: "plain" as const, value, fingerprint: fp }
          : { name, kind: "secret" as const, fingerprint: fp };
      });
      config.push({ file, keys });
    }

    if (opts.skipIfUnchanged && last) {
      try {
        const prev = readManifest(p, last);
        if (sameState(p, prev, head, tree, files, config)) return { checkpoint: summarize(prev), skipped: true };
      } catch {
        // The newest checkpoint is unreadable. Save a fresh one.
      }
    }
    const id = `cp-${String(nextNumber(p)).padStart(4, "0")}`;
    git(p.root, p.env, ["update-ref", `refs/tm/${id}`, snapshot]);
    try {
      return finishCheckpoint(p, id, opts, { head, branch, remote, snapshot, changedTracked, dirty: changedTracked > 0 || candidates.length > 0 }, files, config, missing, manual, cfg, ids);
    } catch (e) {
      gitTry(p.root, p.env, ["update-ref", "-d", `refs/tm/${id}`]);
      throw e;
    }
  });
}

function finishCheckpoint(
  p: Project,
  id: string,
  opts: CheckpointOptions,
  gitInfo: Manifest["git"],
  files: Manifest["files"],
  config: Manifest["config"],
  missing: string[],
  manual: string[],
  cfg: ProjectConfig,
  ids: string[],
): CheckpointResult {
  const { snapshot, changedTracked, branch } = gitInfo;
  const environment = {
    runtimes: runtimeVersions(p),
    lockfiles: digests(p.root, LOCKFILES),
    definitions: digests(p.root, cfg.environment.files),
  };

  const captured = [`Code: commit ${short(snapshot)}${branch ? ` on ${branch}` : ""}${changedTracked ? `, including ${plural(changedTracked, "uncommitted change")}` : ""}`];
  const restorable = ["Code"];
  if (files.length) {
    captured.push(`Files: ${plural(files.length, "file")} not in Git`);
    restorable.push(plural(files.length, "saved file"));
  }
  for (const c of config) {
    const plain = c.keys.filter((k) => k.kind === "plain");
    const secret = c.keys.filter((k) => k.kind === "secret");
    captured.push(`Config: ${plural(c.keys.length, "key")} in ${c.file} (${plain.length} saved, ${secret.length} name only)`);
    if (plain.length) restorable.push(`Config values: ${plain.map((k) => k.name).join(", ")}`);
    if (secret.length) manual.push(`Secret values in ${c.file}: ${secret.map((k) => k.name).join(", ")}`);
  }
  // A digest alone is only a record. The file comes back when the snapshot commit holds it or it was saved as a file.
  const tracked = new Set(splitZ(git(p.root, p.env, ["ls-files", "-z"])));
  const saved = new Set(files.map((f) => f.path));
  const comesBack = (d: { path: string }): boolean => (tracked.has(d.path) && !cfg.config.files.includes(d.path)) || saved.has(d.path);
  if (environment.lockfiles.length) {
    captured.push(`Dependencies: ${environment.lockfiles.map((l) => l.path).join(", ")}`);
    const back = environment.lockfiles.filter(comesBack);
    if (back.length) restorable.push(`Dependencies: ${back.map((l) => l.path).join(", ")}`);
  }
  if (environment.definitions.length) {
    captured.push(`Environment definition: ${environment.definitions.map((d) => d.path).join(", ")}`);
    const back = environment.definitions.filter(comesBack);
    if (back.length) restorable.push(`Environment definition: ${back.map((d) => d.path).join(", ")}`);
  }
  captured.push(`Environment: ${Object.entries(environment.runtimes).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  // Folders like node_modules or build output that Git skips. They are not saved unless capture.include names them.
  const skip = new Set([...cfg.config.files, ...files.map((f) => f.path)]);
  const ignored = splitZ(git(p.root, p.env, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"])).filter((f) => !skip.has(f));
  if (ignored.length) manual.push(`Files your .gitignore skips were not saved: ${ignored.slice(0, 3).join(", ")}${ignored.length > 3 ? ` and ${ignored.length - 3} more` : ""}`);
  manual.push(NOT_CAPTURED);

  // A bundle in the store keeps the commits alive even if the project folder is deleted.
  // Earlier commits that are gone from this repository cannot be used as a base.
  const prior = ids.flatMap((pid) => {
    try {
      const s = readManifest(p, pid).git.snapshot;
      return gitTry(p.root, p.env, ["cat-file", "-e", `${s}^{commit}`]).code === 0 ? [s] : [];
    } catch {
      return [];
    }
  });
  const bundleName = `${id}.bundle`;
  const bundlePath = join(p.store, "bundles", bundleName);
  const b = gitTry(p.root, p.env, ["bundle", "create", "-q", bundlePath, `refs/tm/${id}`, ...prior.map((s) => `^${s}`)]);
  let bundle: string | null = null;
  if (b.code === 0) {
    chmodSync(bundlePath, 0o444);
    bundle = bundleName;
  } else if (!/empty bundle/i.test(b.stderr)) {
    throw new Error(`git bundle failed: ${b.stderr.trim()}`);
  }

  const manifest = writeManifest(p, {
    storeVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    note: looksSecret(opts.note ?? "") ? HIDDEN_NOTE : (opts.note ?? ""),
    trigger: opts.trigger ?? "manual",
    agent: agentFor(opts.trigger ?? "manual", opts.agent),
    project: { root: p.root, name: p.name },
    git: gitInfo,
    files,
    config,
    environment,
    coverage: { captured, restorable, missing, manual },
    bundle,
  });
  audit(p, "checkpoint", id, "saved");
  return { checkpoint: summarize(manifest), skipped: false };
}
