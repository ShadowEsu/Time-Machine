import { join } from "node:path";
import { z } from "zod";
import type { Project } from "./project.js";
import { appendJsonl, readJsonl } from "./store.js";
import type { VerdictRecord } from "./types.js";
import { VERDICTS } from "./verdict.js";

const VerdictRecordSchema = z.object({
  at: z.string(),
  checkpoint: z.string(),
  verdict: z.enum(VERDICTS),
  isolation: z.literal("host"),
  network: z.object({ policy: z.enum(["allow", "deny"]), enforcedBy: z.string().nullable() }),
  command: z.string(),
  durationMs: z.number(),
  exitCode: z.number().nullable(),
  reason: z.string(),
  log: z.string().nullable(),
});

export function recordVerdict(p: Project, r: VerdictRecord): void {
  appendJsonl(join(p.store, "verdicts.jsonl"), r);
}

/** The most recent verdict for each checkpoint. */
export function latestVerdicts(p: Project): Map<string, VerdictRecord> {
  const out = new Map<string, VerdictRecord>();
  for (const raw of readJsonl(join(p.store, "verdicts.jsonl"))) {
    const r = VerdictRecordSchema.safeParse(raw);
    if (r.success) out.set(r.data.checkpoint, r.data);
  }
  return out;
}

/** The most recent verdict recorded for any checkpoint. */
export function lastVerdict(p: Project): VerdictRecord | null {
  const all = readJsonl(join(p.store, "verdicts.jsonl"));
  for (let i = all.length - 1; i >= 0; i--) {
    const r = VerdictRecordSchema.safeParse(all[i]);
    if (r.success) return r.data;
  }
  return null;
}
