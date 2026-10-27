// Thinning old auto saves. Auto save can add a save point every minute, so old ones are thinned on
// request, never on its own. Only save points with trigger "auto" can go. Working (PASS), pinned,
// named or noted, recovery-linked, the newest 20 and anything from the last 24 hours always stay.
// Older auto saves keep one per hour for 7 days, then one per day.
import { chmodSync, existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { audit, auditEntries } from "./audit.js";
import { TmError } from "./errors.js";
import { gitTry } from "./git.js";
import type { Manifest } from "./manifest.js";
import { notes } from "./notes.js";
import { resolveProject, type Project } from "./project.js";
import { blobPath, listIds, readManifest, withLock } from "./store.js";
import type { Ctx, ThinPreview } from "./types.js";
import { latestVerdicts } from "./verdicts.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEEP_NEWEST = 20;

export interface ThinOptions {
  /** The time to measure ages from. Tests pass a later time instead of waiting days. */
  now?: number;
}

function size(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** The save points whose manifest reads and passes its integrity check. The rest are listed as unreadable in the preview. */
function readable(p: Project, ids: string[]): Map<string, Manifest> {
  const out = new Map<string, Manifest>();
  for (const id of ids) {
    try {
      out.set(id, readManifest(p, id));
    } catch {
      // Unreadable save points are never thinned; they stay for a person to look at.
    }
  }
  return out;
}

/** Store files only the `gone` save points use: manifests, bundles, check logs, and saved files no kept save point shares. */
function filesOnlyFor(p: Project, gone: Set<string>, manifests: Map<string, Manifest>): string[] {
  const keptBlobs = new Set<string>();
  for (const [id, m] of manifests) if (!gone.has(id)) for (const f of m.files) keptBlobs.add(f.sha256);
  const logs = existsSync(join(p.store, "logs")) ? readdirSync(join(p.store, "logs")) : [];
  const out = new Set<string>();
  for (const id of gone) {
    out.add(join(p.store, "checkpoints", `${id}.json`));
    out.add(join(p.store, "bundles", `${id}.bundle`));
    for (const name of logs) if (name.startsWith(`${id}-`)) out.add(join(p.store, "logs", name));
    for (const f of manifests.get(id)?.files ?? []) if (!keptBlobs.has(f.sha256)) out.add(blobPath(p, f.sha256));
  }
  return [...out];
}

function plan(ctx: Ctx, p: Project, now: number): { preview: ThinPreview; manifests: Map<string, Manifest> } {
  const ids = listIds(p);
  const manifests = readable(p, ids);
  const verdicts = latestVerdicts(p);
  const noted = new Set(Object.keys(notes(ctx)));
  const linked = new Set(auditEntries(p).filter((e) => e.action === "recover" || e.action === "undo-recover").flatMap((e) => (e.target ? [e.target] : [])));
  const newest = new Set(ids.slice(-KEEP_NEWEST));
  // Hours (within 7 days) and days (older) that already have a save point staying.
  const covered = new Set<string>();
  const remove: ThinPreview["remove"] = [];
  for (const id of [...ids].reverse()) {
    const m = manifests.get(id);
    const at = m ? Date.parse(m.createdAt) : Number.NaN;
    if (!m || Number.isNaN(at)) continue;
    const age = now - at;
    const bucket = age <= 7 * DAY ? `hour ${Math.floor(at / HOUR)}` : `day ${Math.floor(at / DAY)}`;
    const stays = m.trigger !== "auto" || age < DAY || verdicts.get(id)?.verdict === "PASS" || noted.has(id) || linked.has(id) || newest.has(id);
    if (stays || !covered.has(bucket)) {
      covered.add(bucket);
      continue;
    }
    remove.push({ id, at: m.createdAt, reason: bucket.startsWith("hour") ? "Another save point from the same hour stays." : "Another save point from the same day stays." });
  }
  remove.reverse();
  const bytesFreed = filesOnlyFor(p, new Set(remove.map((r) => r.id)), manifests).reduce((n, f) => n + size(f), 0);
  const unreadable = ids.filter((id) => !manifests.has(id));
  return { preview: { remove, keep: ids.length - remove.length, bytesFreed, unreadable }, manifests };
}

/** Which old auto saves of the project at ctx.cwd can go, why, and about how many bytes that frees. Reads only. */
export function thinPreview(ctx: Ctx, opts: ThinOptions = {}): ThinPreview {
  return plan(ctx, resolveProject(ctx), opts.now ?? Date.now()).preview;
}

/**
 * Removes the given auto saves. Every id must be in a fresh preview, made here under the store lock,
 * or nothing is removed. While any save point can't be read, nothing is removed either: its manifest
 * is the only record of which saved files it needs, so none could be deleted safely. Removes each
 * one's manifest, pin, bundle and check logs, and saved files no kept save point shares. The bundles
 * of later kept save points are rebuilt so the store copy stays complete without the removed ones.
 */
export async function thinApply(ctx: Ctx, ids: string[], opts: ThinOptions = {}): Promise<{ removed: number }> {
  const p = resolveProject(ctx);
  return withLock(p, async () => {
    const { preview, manifests } = plan(ctx, p, opts.now ?? Date.now());
    const allowed = new Set(preview.remove.map((r) => r.id));
    const bad = ids.find((id) => !allowed.has(id));
    if (bad !== undefined) throw new TmError("usage", `${bad} can't be thinned now: only old auto saves in a fresh preview can go. Nothing was removed.`);
    const gone = new Set(ids);
    if (!gone.size) return { removed: 0 };
    if (preview.unreadable.length) {
      throw new TmError("integrity", `${preview.unreadable.join(", ")} can't be read; nothing was removed. A save point that can't be read may still need saved files that thinning would delete.`);
    }
    // Manifests first: once it is gone, a save point is gone, even if a later step stops.
    for (const id of gone) rmSync(join(p.store, "checkpoints", `${id}.json`), { force: true });
    for (const id of gone) gitTry(p.root, p.env, ["update-ref", "-d", `refs/tm/${id}`]);
    for (const f of filesOnlyFor(p, gone, manifests)) rmSync(f, { force: true });
    rebuildBundles(p, gone, manifests);
    audit(p, "thin", null, `removed ${gone.size} old auto save${gone.size === 1 ? "" : "s"}: ${[...gone].join(", ")}`);
    return { removed: gone.size };
  });
}

/**
 * Each bundle holds a save point's commits that earlier save points did not have. After a removal, the
 * kept save points after the first removed one get their bundle rebuilt against the earlier kept ones.
 */
function rebuildBundles(p: Project, gone: Set<string>, manifests: Map<string, Manifest>): void {
  const first = [...gone].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))[0];
  if (!first) return;
  const kept = [...manifests.keys()].filter((id) => !gone.has(id));
  const prior: string[] = [];
  for (const id of kept) {
    const snapshot = manifests.get(id)?.git.snapshot ?? "";
    if (Number(id.slice(3)) > Number(first.slice(3))) {
      const path = join(p.store, "bundles", `${id}.bundle`);
      const tmp = `${path}.${process.pid}.tmp`;
      const b = gitTry(p.root, p.env, ["bundle", "create", "-q", tmp, `refs/tm/${id}`, ...prior.map((s) => `^${s}`)]);
      if (b.code === 0) {
        chmodSync(tmp, 0o444);
        renameSync(tmp, path);
      } else rmSync(tmp, { force: true }); // An empty bundle: earlier kept bundles already hold its commits.
    }
    if (gitTry(p.root, p.env, ["cat-file", "-e", `${snapshot}^{commit}`]).code === 0) prior.push(snapshot);
  }
}
