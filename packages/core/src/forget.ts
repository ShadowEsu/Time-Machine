// tm forget: take back what tm init and tm hook install agreed to on this computer. The check's approval is removed, so
// the Claude Code plugin's hooks and the MCP check tools step aside here, and the hook lines tm hook install added are
// taken out of .claude/settings.json. Save points stay in the store until the person deletes them.
import { existsSync } from "node:fs";
import { audit } from "./audit.js";
import { removeConsent } from "./consent.js";
import { hookRemove } from "./hooks.js";
import { resolveProject } from "./project.js";
import type { Ctx } from "./types.js";

export interface ForgetResult {
  /** True when this computer had approved the project's check and that approval is now gone. */
  approvalRemoved: boolean;
  /** Settings files hook lines were taken out of, and for which Claude Code events. */
  hooksRemoved: { path: string; removed: string[] }[];
  /** Settings files that are not plain JSON in the expected shape, or are links to somewhere else, so they were left alone. */
  unreadable: string[];
  /** Where the save points are. They are not deleted. */
  store: string;
}

export function forget(ctx: Ctx): ForgetResult {
  const p = resolveProject(ctx);
  const approvalRemoved = removeConsent(p);
  // A plain folder never gets hook lines, and Time Machine never writes in one.
  const hooks = p.kind === "folder" ? { files: [], unreadable: [] } : hookRemove(p);
  // Logged only where a store exists, so forgetting a project that was never set up creates nothing.
  if (existsSync(p.store)) audit(p, "forget", null, `approval ${approvalRemoved ? "removed" : "not set"}; hook lines removed from ${hooks.files.length} file(s)`);
  return { approvalRemoved, hooksRemoved: hooks.files, unreadable: hooks.unreadable, store: p.store };
}
