import { join } from "node:path";
import { z } from "zod";
import type { Project } from "./project.js";
import { appendJsonl, readJsonl, readManifest, sign } from "./store.js";
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

const StoredSchema = z.object({ record: VerdictRecordSchema, manifest: z.string(), seal: z.string() });

/** Stores a verdict signed and bound to the exact manifest it was made for. */
export function recordVerdict(p: Project, r: VerdictRecord, manifestIntegrity: string | null): void {
  if (!manifestIntegrity) return; // Nothing trustworthy to bind it to. The result is still returned.
  const body = { record: r, manifest: manifestIntegrity };
  appendJsonl(join(p.store, "verdicts.jsonl"), { ...body, seal: sign(p, body) });
}

/** Valid verdicts in the order they were recorded. Forged, unsigned or stale lines are dropped. */
function validVerdicts(p: Project): VerdictRecord[] {
  const integrity = new Map<string, string | null>();
  const current = (id: string): string | null => {
    if (!integrity.has(id)) {
      try {
        integrity.set(id, readManifest(p, id).integrity);
      } catch {
        integrity.set(id, null);
      }
    }
    return integrity.get(id) ?? null;
  };
  return readJsonl(join(p.store, "verdicts.jsonl")).flatMap((raw) => {
    const r = StoredSchema.safeParse(raw);
    if (!r.success) return [];
    const { seal, ...body } = r.data;
    if (sign(p, body) !== seal || current(body.record.checkpoint) !== body.manifest) return [];
    return [body.record];
  });
}

/** The most recent verdict for each checkpoint. */
export function latestVerdicts(p: Project): Map<string, VerdictRecord> {
  const out = new Map<string, VerdictRecord>();
  for (const r of validVerdicts(p)) out.set(r.checkpoint, r);
  return out;
}

/** The most recent verdict recorded for any checkpoint. */
export function lastVerdict(p: Project): VerdictRecord | null {
  return validVerdicts(p).at(-1) ?? null;
}
