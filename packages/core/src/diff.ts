import { git, splitZ } from "./git.js";
import type { Manifest } from "./manifest.js";
import { resolveProject } from "./project.js";
import { readManifest } from "./store.js";
import type { Ctx, DiffResult } from "./types.js";

function compare<T>(a: Map<string, T>, b: Map<string, T>, same: (x: T, y: T) => boolean): { added: string[]; removed: string[]; changed: string[] } {
  return {
    added: [...b.keys()].filter((k) => !a.has(k)),
    removed: [...a.keys()].filter((k) => !b.has(k)),
    changed: [...a.keys()].filter((k) => b.has(k) && !same(a.get(k) as T, b.get(k) as T)),
  };
}

function configKeys(m: Manifest): Map<string, string> {
  return new Map(m.config.flatMap((c) => c.keys.map((k) => [`${c.file}:${k.name}`, k.fingerprint] as [string, string])));
}

export async function diff(ctx: Ctx, a: string, b: string): Promise<DiffResult> {
  const p = resolveProject(ctx);
  const ma = readManifest(p, a);
  const mb = readManifest(p, b);
  const raw = splitZ(git(p.root, p.env, ["diff", "-z", "--name-status", "--no-renames", ma.git.snapshot, mb.git.snapshot, "--"]));
  const code: DiffResult["code"] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) code.push({ status: raw[i] ?? "", path: raw[i + 1] ?? "" });
  const files = compare(new Map(ma.files.map((f) => [f.path, f.sha256])), new Map(mb.files.map((f) => [f.path, f.sha256])), (x, y) => x === y);
  const config = compare(configKeys(ma), configKeys(mb), (x, y) => x === y);
  const deps = compare(new Map(ma.environment.lockfiles.map((l) => [l.path, l.sha256])), new Map(mb.environment.lockfiles.map((l) => [l.path, l.sha256])), (x, y) => x === y);
  const defs = compare(new Map(ma.environment.definitions.map((l) => [l.path, l.sha256])), new Map(mb.environment.definitions.map((l) => [l.path, l.sha256])), (x, y) => x === y);
  const rt = compare(new Map(Object.entries(ma.environment.runtimes)), new Map(Object.entries(mb.environment.runtimes)), (x, y) => x === y);
  return {
    a,
    b,
    code,
    files,
    config,
    dependencies: { changed: [...deps.added, ...deps.removed, ...deps.changed] },
    environment: { changed: [...defs.added, ...defs.removed, ...defs.changed, ...rt.added, ...rt.removed, ...rt.changed] },
  };
}
