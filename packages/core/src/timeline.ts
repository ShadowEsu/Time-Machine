import { summarize } from "./checkpoint.js";
import { TmError } from "./errors.js";
import { resolveProject } from "./project.js";
import { listIds, readManifest } from "./store.js";
import type { Ctx, TimelineEntry, TimelineResult } from "./types.js";
import { latestVerdicts } from "./verdicts.js";

export async function timeline(ctx: Ctx): Promise<TimelineResult> {
  const p = resolveProject(ctx);
  const verdicts = latestVerdicts(p);
  const checkpoints: TimelineEntry[] = listIds(p).map((id) => {
    try {
      const v = verdicts.get(id);
      return { ...summarize(readManifest(p, id)), verdict: v?.verdict ?? null, isolation: v?.isolation ?? null };
    } catch (e) {
      const reason = e instanceof TmError ? e.message : String(e);
      return {
        id, createdAt: "", note: reason, trigger: "", agent: null, commit: "", branch: null, dirty: false, files: 0,
        coverage: { captured: [], restorable: [], missing: [], manual: [] }, verdict: "ERROR", isolation: null,
      };
    }
  });
  return { project: p.root, checkpoints };
}
