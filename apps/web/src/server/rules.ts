// Pure decisions for the Claude Code connection and the hook command. No server imports,
// so they are unit tested in apps/web/test.
import { npxHookCandidates, shellQuote as quote } from "@timetm/core";

/** A turn with no "ended" line after this long is treated as over (the agent was killed). */
export const AGENT_TURN_STALE_MS = 60 * 60 * 1000;

/**
 * When the agent turn in progress started, from the audit log the Claude Code hooks write:
 * "agent-turn started" at each prompt and "agent-turn ended" when the agent stops.
 * Null when no turn is in progress or the last one went stale.
 */
export function agentTurnStart(entries: { at: string; action: string; result: string }[], now: number): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.action !== "agent-turn") continue;
    const at = Date.parse(e.at);
    return e.result === "started" && Number.isFinite(at) && now - at < AGENT_TURN_STALE_MS ? e.at : null;
  }
  return null;
}

/**
 * The commands the Claude Code hooks could call, best first. TM_HOOK_COMMAND wins on its own.
 * Then the bundled CLI that serves this app, as quoted absolute paths with the Node that runs it.
 * Last, npx with the version pinned, never the bare package name, and only once the package is
 * published (core `NPM_PUBLISHED`), so an unowned npm name is never run.
 */
export function hookCandidates(o: { override: string | undefined; nodePath: string; cliScript: string | null; version: string }): string[] {
  if (o.override) return [o.override];
  const own = o.cliScript ? [`${quote(o.nodePath)} ${quote(o.cliScript)}`] : [];
  return [...own, ...npxHookCandidates(o.version)];
}

/** The first command that runs. When none does, the last one, marked as not running. */
export async function firstRunning(candidates: string[], probe: (command: string) => Promise<boolean>): Promise<{ command: string; runs: boolean }> {
  for (const command of candidates) if (await probe(command)) return { command, runs: true };
  return { command: candidates.at(-1) ?? "", runs: false };
}
