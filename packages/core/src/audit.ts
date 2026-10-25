import { join } from "node:path";
import { z } from "zod";
import { resolveProject, type Project } from "./project.js";
import { clipSafe } from "./secrets.js";
import { appendJsonl, ensureStore, readJsonl } from "./store.js";
import type { AuditEntry, Ctx, LogResult } from "./types.js";

const AuditEntrySchema = z.object({ at: z.string(), action: z.string(), target: z.string().nullable(), result: z.string() });

/** Append only. Never contains secret values: callers pass IDs and verdicts, not content. */
export function audit(p: Project, action: string, target: string | null, result: string): void {
  ensureStore(p);
  const entry: AuditEntry = { at: new Date().toISOString(), action, target, result };
  appendJsonl(join(p.store, "audit.jsonl"), entry);
}

/** Records that an auto save of the project at ctx.cwd failed: one line, clipped, hidden if it looks secret. */
export function auditAutoSaveFailed(ctx: Ctx, message: string): void {
  audit(resolveProject(ctx), "autosave-failed", null, clipSafe(message, 300));
}

/** The project's audit entries, oldest first. Lines that do not parse are left out. */
export function auditEntries(p: Project): AuditEntry[] {
  return readJsonl(join(p.store, "audit.jsonl")).flatMap((e) => {
    const r = AuditEntrySchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
}

export async function log(ctx: Ctx): Promise<LogResult> {
  return { entries: auditEntries(resolveProject(ctx)) };
}
