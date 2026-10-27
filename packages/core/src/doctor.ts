// What the store holds, and whether it is whole: every project in it (tm list, the app's import list),
// and every save point's manifest, Git ref and saved files (tm doctor).
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { TmError } from "./errors.js";
import { goneFromStore } from "./materialize.js";
import { resolveProject, storeProjectList, type Project } from "./project.js";
import { getBlob, listIds, readManifest } from "./store.js";
import { damage, tmRefs } from "./timeline.js";
import type { Ctx, IntegrityReport, StoreProject } from "./types.js";

/** Bytes a folder takes, links not followed. */
function folderBytes(dir: string): number {
  let n = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const full = join(dir, name);
    const st = lstatSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    n += st.isDirectory() ? folderBytes(full) : st.size;
  }
  return n;
}

const CreatedAt = z.object({ createdAt: z.string() });

/** When the newest save point was made. Read from its manifest without the seal check: a list only shows it. */
function newestTime(p: Project, ids: string[]): string | null {
  for (const id of [...ids].reverse()) {
    try {
      const r = CreatedAt.safeParse(JSON.parse(readFileSync(join(p.store, "checkpoints", `${id}.json`), "utf8")));
      if (r.success) return r.data.createdAt;
    } catch {
      // Try the one before.
    }
  }
  return null;
}

/** Every project in the store under ctx's home, whether or not the app lists it. Folders that are gone are listed too. */
export function storeProjects(ctx: Ctx): StoreProject[] {
  return storeProjectList(ctx).map((p) => {
    const ids = listIds(p);
    return { root: p.root, name: p.name, kind: p.kind, store: p.store, savePoints: ids.length, lastSaved: newestTime(p, ids), sizeBytes: folderBytes(p.store), missing: p.missing };
  });
}

function integrityOf(p: Project): IntegrityReport {
  const report: IntegrityReport = { root: p.root, kind: p.kind, missing: p.missing, checked: 0, damaged: [], missingBlobs: [], notes: [] };
  const refs = tmRefs(p);
  if (!refs) report.notes.push(p.missing ? `${p.root} is gone, so its Git refs could not be checked.` : "Git could not list the save point refs, so they were not checked.");
  // Each saved copy is read and its hash checked once, however many save points share it.
  const blobs = new Map<string, string | null>();
  for (const id of listIds(p)) {
    report.checked++;
    let m;
    try {
      m = readManifest(p, id);
    } catch (e) {
      report.damaged.push({ id, reason: e instanceof TmError ? e.message : String(e) });
      continue;
    }
    const ref = damage(p, { ...m, files: [] }, refs, new Map());
    if (ref) report.damaged.push({ id, reason: ref });
    for (const f of m.files) {
      if (!blobs.has(f.sha256)) {
        try {
          blobs.set(f.sha256, getBlob(p, f.sha256, f.path) ? null : goneFromStore(f.path));
        } catch (e) {
          blobs.set(f.sha256, e instanceof TmError ? e.message : String(e));
        }
      }
      const problem = blobs.get(f.sha256);
      if (problem) report.missingBlobs.push({ id, path: f.path, reason: problem.includes(f.path) ? problem : `the saved copy of ${f.path} is damaged` });
    }
  }
  return report;
}

/** Checks the project at ctx.cwd: every save point's manifest seal, its Git ref, and each saved file's copy and hash. */
export function checkIntegrity(ctx: Ctx): IntegrityReport {
  return integrityOf(resolveProject(ctx));
}

/** checkIntegrity for every project in the store, for tm doctor. */
export function checkStore(ctx: Ctx): IntegrityReport[] {
  return storeProjectList(ctx).map(integrityOf);
}
