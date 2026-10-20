// Pure decisions for the menu bar dot, the corner card, the agent pill and where windows go.
// No Electron imports, so they are unit tested in apps/desktop/test.
import { npxHookCommand, shellQuote as quote } from "@timetm/core";
import type { ProjectStatus, Verdict } from "../shared/api.js";

export type DotState = "pass" | "fail" | "none" | "working";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A project's current verdict: the newest save point that has been checked. Null when none has. */
export function projectVerdict(points: { id: string; verdict: Verdict | null }[]): { id: string; verdict: Verdict } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p?.verdict) return { id: p.id, verdict: p.verdict };
  }
  return null;
}

/**
 * The corner card appears only when a project's verdict turns from PASS to FAIL. Nothing
 * else interrupts. Not while the app window has focus (it already shows the result), and
 * not while the app itself is searching for the last working version.
 */
export function shouldShowBreakCard(
  before: { verdict: Verdict } | null,
  after: { verdict: Verdict } | null,
  ctx: { cardsOn: boolean; windowFocused: boolean; findingGood: boolean },
): boolean {
  return before?.verdict === "PASS" && after?.verdict === "FAIL" && ctx.cardsOn && !ctx.windowFocused && !ctx.findingGood;
}

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
 * The menu bar dot. Worst state wins, so a broken project is never hidden behind a green one.
 * Green only when every project's newest save point has a real PASS.
 */
export function dotState(newest: (Verdict | null)[], working: boolean): DotState {
  if (newest.includes("FAIL")) return "fail";
  if (working) return "working";
  if (newest.length && newest.every((v) => v === "PASS")) return "pass";
  return "none";
}

/** What the dot rests on per project. A project that moved or has no save points counts as unchecked, never as working. */
export function trayVerdicts(statuses: ProjectStatus[]): (Verdict | null)[] {
  return statuses.map((s) => (s.problem ? null : (s.newest?.verdict ?? null)));
}

/**
 * The commands the Claude Code hooks could call, best first. TM_HOOK_COMMAND wins on its own,
 * but only in a development build: a packaged app ignores it.
 * Then the CLI this app can run itself, as quoted absolute paths with the app's own Node
 * (Electron run as Node). Last, npx with the version pinned, never the bare package name.
 */
export function hookCandidates(o: { override: string | undefined; packaged: boolean; nodePath: string; cliScript: string | null; version: string }): string[] {
  if (o.override && !o.packaged) return [o.override];
  const own = o.cliScript ? [`ELECTRON_RUN_AS_NODE=1 ${quote(o.nodePath)} ${quote(o.cliScript)}`] : [];
  return [...own, npxHookCommand(o.version)];
}

/** The first command that runs. When none does, the last one, marked as not running. */
export async function firstRunning(candidates: string[], probe: (command: string) => Promise<boolean>): Promise<{ command: string; runs: boolean }> {
  for (const command of candidates) if (await probe(command)) return { command, runs: true };
  return { command: candidates.at(-1) ?? "", runs: false };
}

/** Keeps a window of this size inside the work area, centered on it when it has to move. */
export function placeOn(area: Rect, current: Rect): Rect {
  const width = Math.min(current.width, area.width);
  const height = Math.min(current.height, area.height);
  const inside = current.x >= area.x && current.y >= area.y && current.x + width <= area.x + area.width && current.y + height <= area.y + area.height;
  if (inside) return { x: current.x, y: current.y, width, height };
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
}
