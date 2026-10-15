import { join } from "node:path";
import { z } from "zod";
import { resolveProject, type Project } from "./project.js";
import { appendJsonl, ensureStore, readJsonl } from "./store.js";
import type { AuditEntry, Ctx, LogResult } from "./types.js";

const AuditEntrySchema = z.object({ at: z.string(), action: z.string(), target: z.string().nullable(), result: z.string() });

/** Append only. Never contains secret values: callers pass IDs and verdicts, not content. */
export function audit(p: Project, action: string, target: string | null, result: string): void {
  ensureStore(p);
  const entry: AuditEntry = { at: new Date().toISOString(), action, target, result };
  appendJsonl(join(p.store, "audit.jsonl"), entry);
}

export async function log(ctx: Ctx): Promise<LogResult> {
  const p = resolveProject(ctx);
  const entries = readJsonl(join(p.store, "audit.jsonl")).flatMap((e) => {
    const r = AuditEntrySchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
  return { entries };
}
