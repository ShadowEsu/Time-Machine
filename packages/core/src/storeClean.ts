// D07: frees space in the store without touching any save point. Only check logs that a
// newer check of the same save point replaced are removed. Thinning save points is planned.
import { existsSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { audit } from "./audit.js";
import { resolveProject } from "./project.js";
import type { Ctx } from "./types.js";
import { validVerdicts } from "./verdicts.js";

export interface CleanStoreResult {
  /** Paths inside the store, relative to it, that were (or would be) removed. */
  files: string[];
  bytes: number;
  /** False for a preview. Nothing was removed. */
  applied: boolean;
}

export async function cleanStore(ctx: Ctx, opts: { apply: boolean }): Promise<CleanStoreResult> {
  const p = resolveProject(ctx);
  const records = validVerdicts(p);
  // The newest log per save point stays. A log no signed verdict points at (for example a
  // check still running) is never touched.
  const keep = new Map<string, string | null>();
  for (const r of records) keep.set(r.checkpoint, r.log ? basename(r.log) : null);
  const files: string[] = [];
  let bytes = 0;
  for (const r of records) {
    if (!r.log) continue;
    const name = basename(r.log);
    const path = join(p.store, "logs", name);
    const rel = `logs/${name}`;
    if (keep.get(r.checkpoint) === name || files.includes(rel) || !existsSync(path)) continue;
    files.push(rel);
    bytes += statSync(path).size;
  }
  if (opts.apply && files.length) {
    for (const f of files) rmSync(join(p.store, f), { force: true });
    audit(p, "clean", null, `removed ${files.length} old check log${files.length === 1 ? "" : "s"}`);
  }
  return { files, bytes, applied: opts.apply };
}
