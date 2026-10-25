// Facts about a project's history that are safe to describe outside the store, for example
// to an assistant the person turned on. Never check output, file contents or secret values.
import { loadConfig } from "./config.js";
import { configRoot, resolveProject } from "./project.js";
import { holdsSecretValue, looksSecret } from "./secrets.js";
import type { Ctx } from "./types.js";
import { latestVerdicts } from "./verdicts.js";
import { secretValues } from "./verify.js";

/** The check behind each save point's newest verdict: its command and exit code. Never its output or log. */
export function checkRuns(ctx: Ctx): Map<string, { command: string; exitCode: number | null }> {
  const p = resolveProject(ctx);
  return new Map([...latestVerdicts(p)].map(([id, r]) => [id, { command: r.command, exitCode: r.exitCode }]));
}

/**
 * A test for free text: true when it looks like a secret or holds a secret value from the
 * project's config files (such as .env). The values stay inside this function.
 */
export function secretScreen(ctx: Ctx): (text: string) => boolean {
  const p = resolveProject(ctx);
  const values = secretValues([p.root], loadConfig(configRoot(p)).config);
  return (text) => looksSecret(text) || holdsSecretValue(text, values);
}
