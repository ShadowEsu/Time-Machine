import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { audit } from "./audit.js";
import { CONFIG_FILE, ProjectConfigSchema } from "./config.js";
import { TmError } from "./errors.js";
import { resolveProject } from "./project.js";
import type { Ctx, SetCheckResult } from "./types.js";

/**
 * Changes the check (verify.command) in timemachine.yml and keeps the rest of the file,
 * comments included. The audit log records that it changed, never the command itself.
 */
export async function setCheck(ctx: Ctx, command: string): Promise<SetCheckResult> {
  const p = resolveProject(ctx);
  const path = join(p.root, CONFIG_FILE);
  if (!existsSync(path)) throw new TmError("usage", `There is no ${CONFIG_FILE} yet. Run tm init first.`);
  const cmd = command.trim();
  if (!cmd) throw new TmError("usage", "The check cannot be empty. For example: npm test.");
  if (/[\r\n\0]/.test(cmd)) throw new TmError("usage", "The check must be one line.");
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length) throw new TmError("usage", `${CONFIG_FILE} is not valid YAML: ${doc.errors[0]?.message ?? ""}`);
  doc.setIn(["verify", "command"], cmd);
  const r = ProjectConfigSchema.safeParse(doc.toJS());
  if (!r.success) throw new TmError("usage", `${CONFIG_FILE} has a problem, so it was left alone.`);
  writeFileSync(path, doc.toString());
  audit(p, "set-check", null, "changed the check");
  return { configPath: path, verifyCommand: r.data.verify.command };
}
