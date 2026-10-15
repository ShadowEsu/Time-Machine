import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "./audit.js";
import { loadConfig, LOCKFILES, type ProjectConfig } from "./config.js";
import { git, gitTry, safeRemote, short, splitZ } from "./git.js";
import type { Manifest } from "./manifest.js";
import { runSync } from "./exec.js";
import { resolveProject, type Project } from "./project.js";
import { fingerprint, isBinary, looksSecret, parseDotenv } from "./secrets.js";
import { ensureStore, listIds, putBlob, readManifest, sha256, storeKey, withLock, writeManifest } from "./store.js";
import type { CheckpointResult, CheckpointSummary, Ctx } from "./types.js";

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
    commit: m.git.snapshot,
    branch: m.git.branch,
    dirty: m.git.dirty,
    files: m.files.length,
    coverage: m.coverage,
  };
}

/** Records the tracked working tree as a commit without touching the user's index, HEAD or branch. */
function snapshotCommit(p: Project, cfg: ProjectConfig, id: string, head: string | null): { snapshot: string; changedTracked: number } {
  const tmp = mkdtempSync(join(tmpdir(), "tm-index-"));
  const index = { GIT_INDEX_FILE: join(tmp, "index") };
  try {
    git(p.root, p.env, head ? ["read-tree", head] : ["read-tree", "--empty"], index);
    const excludes = cfg.config.files.map((f) => `:(exclude)${f}`);
    git(p.root, p.env, ["add", "-u", "--", ".", ...excludes], index);
    const tree = git(p.root, p.env, ["write-tree"], index);
    const headTree = head ? git(p.root, p.env, ["rev-parse", `${head}^{tree}`]) : null;
    if (head && tree === headTree) return { snapshot: head, changedTracked: 0 };
    const changed = head
      ? splitZ(git(p.root, p.env, ["diff-tree", "-r", "-z", "--name-only", headTree ?? head, tree])).length
      : splitZ(git(p.root, p.env, ["ls-files", "-z"], index)).length;
    const args = ["commit-tree", tree, "--no-gpg-sign", "-m", `Time Machine save point ${id}`];
    if (head) args.push("-p", head);
    return { snapshot: git(p.root, p.env, args), changedTracked: changed };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function untrackedCandidates(p: Project, cfg: ProjectConfig, head: string | null): string[] {
  const inHead = new Set(head ? splitZ(git(p.root, p.env, ["ls-tree", "-r", "-z", "--name-only", head])) : []);
  const staged = splitZ(git(p.root, p.env, ["ls-files", "-z"])).filter((f) => !inHead.has(f));
  const others = cfg.capture.untracked ? splitZ(git(p.root, p.env, ["ls-files", "-z", "--others", "--exclude-standard"])) : [];
  const included = cfg.capture.include.length
    ? splitZ(git(p.root, p.env, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...cfg.capture.include]))
    : [];
  const configFiles = new Set(cfg.config.files);
  return [...new Set([...staged, ...others, ...included])].filter((f) => !configFiles.has(f)).sort();
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

export async function checkpoint(ctx: Ctx, opts: { note?: string; trigger?: string } = {}): Promise<CheckpointResult> {
  const p = resolveProject(ctx);
  const { config: cfg } = loadConfig(p.root);
  ensureStore(p);
  return withLock(p, async () => {
    const ids = listIds(p);
    const last = ids.at(-1);
    const id = `cp-${String(last ? Number(last.slice(3)) + 1 : 1).padStart(4, "0")}`;

    const headR = gitTry(p.root, p.env, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
    const head = headR.code === 0 ? headR.stdout.trim() : null;
    const branchR = gitTry(p.root, p.env, ["symbolic-ref", "--short", "-q", "HEAD"]);
    const branch = branchR.code === 0 ? branchR.stdout.trim() : null;
    const remoteR = gitTry(p.root, p.env, ["remote", "get-url", "origin"]);
    const remote = remoteR.code === 0 ? safeRemote(remoteR.stdout.trim()) : null;

    const { snapshot, changedTracked } = snapshotCommit(p, cfg, id, head);
    git(p.root, p.env, ["update-ref", `refs/tm/${id}`, snapshot]);

    const missing: string[] = [];
    const manual: string[] = [];
    const files: Manifest["files"] = [];
    const candidates = untrackedCandidates(p, cfg, head);
    const maxBytes = cfg.capture.maxFileMB * 1024 * 1024;
    for (const rel of candidates) {
      const full = join(p.root, rel);
      if (!existsSync(full)) continue; // staged, then deleted on disk
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        missing.push(`${rel} is a symbolic link, so it was not saved`);
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > maxBytes) {
        missing.push(`${rel} is over the ${cfg.capture.maxFileMB} MB limit`);
        continue;
      }
      const buf = readFileSync(full);
      if (!isBinary(buf) && looksSecret(buf.toString("utf8"))) {
        manual.push(`${rel} looks like it contains a secret, so it was not saved`);
        continue;
      }
      files.push({ path: rel, sha256: putBlob(p, buf), size: st.size, mode: st.mode & 0o777 });
    }

    const key = storeKey(p);
    const config: Manifest["config"] = [];
    for (const file of cfg.config.files) {
      const full = join(p.root, file);
      if (!existsSync(full) || !lstatSync(full).isFile()) continue;
      const keys = parseDotenv(readFileSync(full, "utf8")).map(({ name, value }) => {
        const fp = fingerprint(key, name, value);
        return cfg.config.plain.includes(name) && !looksSecret(value)
          ? { name, kind: "plain" as const, value, fingerprint: fp }
          : { name, kind: "secret" as const, fingerprint: fp };
      });
      config.push({ file, keys });
    }

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
    if (environment.lockfiles.length) captured.push(`Dependencies: ${environment.lockfiles.map((l) => l.path).join(", ")}`);
    captured.push(`Environment: ${Object.entries(environment.runtimes).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    manual.push(NOT_CAPTURED);

    // A bundle in the store keeps the commits alive even if the project folder is deleted.
    const prior = ids.flatMap((pid) => {
      try {
        return [readManifest(p, pid).git.snapshot];
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
      note: opts.note ?? "",
      trigger: opts.trigger ?? "manual",
      project: { root: p.root, name: p.name },
      git: { head, branch, remote, snapshot, changedTracked, dirty: changedTracked > 0 || candidates.length > 0 },
      files,
      config,
      environment,
      coverage: { captured, restorable, missing, manual },
      bundle,
    });
    audit(p, "checkpoint", id, "saved");
    return { checkpoint: summarize(manifest) };
  });
}
