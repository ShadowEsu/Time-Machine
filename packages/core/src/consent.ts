// Consent pinned to the check. A cloned repo can ship timemachine.yml, so the file alone is not
// consent. tm init (and setting the check in the app) records, on this computer only, a hash of
// the exact install step and check the user approved. Plugin hooks and the MCP check tools run
// only while that hash matches.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig, type ProjectConfig } from "./config.js";
import { resolveProject, type Project } from "./project.js";
import type { Ctx, StatusResult } from "./types.js";

const CONSENT_FILE = "consent.json";
const WARNED_FILE = "consent-warned";
const ConsentSchema = z.object({ verifyHash: z.string(), at: z.string() });

export type ConsentState = "approved" | "missing" | "changed";

/** The command a check runs, as tm verify reports it: the install step, then the check. */
export function checkCommand(cfg: ProjectConfig): string {
  return cfg.verify.setup ? `${cfg.verify.setup} && ${cfg.verify.command}` : cfg.verify.command;
}

/** What the user approves: the install step, the check, and the network rule it runs under. A JSON array keeps the fields apart. */
function verifyHash(cfg: ProjectConfig): string {
  return createHash("sha256").update(JSON.stringify([cfg.verify.setup, cfg.verify.command, cfg.verify.network])).digest("hex");
}

/** Records that the user approved this project's current check on this computer. Returns the approved command. */
export function recordConsent(p: Project, cfg: ProjectConfig): string {
  mkdirSync(p.store, { recursive: true });
  const path = join(p.store, CONSENT_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ verifyHash: verifyHash(cfg), at: new Date().toISOString() }) + "\n");
  renameSync(`${path}.tmp`, path);
  return checkCommand(cfg);
}

/** Whether the current check is the one the user approved. Never creates the store. */
export function consentState(p: Project, cfg: ProjectConfig): ConsentState {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(p.store, CONSENT_FILE), "utf8"));
  } catch {
    return "missing";
  }
  const r = ConsentSchema.safeParse(raw);
  if (!r.success) return "missing";
  return r.data.verifyHash === verifyHash(cfg) ? "approved" : "changed";
}

/** True the first time it is asked about this changed check, false after, so the warning shows once per check. */
export function changedWarningDue(p: Project, cfg: ProjectConfig): boolean {
  const path = join(p.store, WARNED_FILE);
  const hash = verifyHash(cfg);
  try {
    if (readFileSync(path, "utf8").trim() === hash) return false;
  } catch {
    // Not warned yet.
  }
  writeFileSync(path, `${hash}\n`);
  return true;
}

/** This project's check and whether this computer approved it. For callers that run the check for an agent. */
export function approvedCheck(ctx: Ctx): { state: ConsentState; command: string } {
  const p = resolveProject(ctx);
  const { config } = loadConfig(p.root);
  return { state: consentState(p, config), command: checkCommand(config) };
}

/** tm status: is this project set up (timemachine.yml) and is its check approved on this computer. Reads only; never creates the store. */
export function status(ctx: Ctx): StatusResult {
  const p = resolveProject(ctx);
  const { config, exists } = loadConfig(p.root);
  const check = exists && config.verify.command.trim() ? checkCommand(config) : null;
  return { initialized: exists, approved: check !== null && consentState(p, config) === "approved", check };
}
