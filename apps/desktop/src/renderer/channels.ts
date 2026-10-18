// Agent channels: one line per coding agent. Claude Code is read from its hook lines and the audit
// log. The others are planned and always say so. No activity is ever invented.
import type { AgentRow } from "../shared/api.js";
import { plural, when } from "../shared/format.js";

export interface Channel {
  name: string;
  /** Two letters in a small square, instead of a third-party logo. */
  mark: string;
  state: "working" | "idle" | "partial" | "not-connected" | "planned";
  /** One plain sentence. */
  line: string;
}

/** Agents without a connection yet. Shown as planned, never as connected. */
export const PLANNED_AGENTS: readonly { name: string; mark: string }[] = [
  { name: "Codex", mark: "Cx" },
  { name: "Gemini CLI", mark: "Gm" },
  { name: "Cursor", mark: "Cu" },
];

/**
 * Claude Code's channel from the hook state of each project. `lastEnded` maps a project id to the
 * time of its newest "agent-turn ended" audit line, when one was read.
 */
export function claudeChannel(rows: AgentRow[], lastEnded: ReadonlyMap<string, string>, now = new Date()): Channel {
  const base = { name: "Claude Code", mark: "CC" };
  const working = rows.filter((r) => r.working);
  if (working.length) {
    const first = working[0];
    const since = first?.workingSince ? ` since ${when(first.workingSince, now)}` : "";
    const where = working.length === 1 ? `in ${first?.name ?? ""}` : `in ${plural(working.length, "project")}`;
    return { ...base, state: "working", line: `Working ${where}${since}.` };
  }
  const connected = rows.filter((r) => r.claudeCode === "connected");
  if (connected.length) {
    const ended = connected
      .map((r) => ({ name: r.name, at: lastEnded.get(r.projectId) }))
      .filter((x): x is { name: string; at: string } => !!x.at)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    const where = connected.length === 1 ? (connected[0]?.name ?? "") : plural(connected.length, "project");
    return { ...base, state: "idle", line: ended ? `Idle. Last turn ended ${when(ended.at, now)} in ${ended.name}.` : `Connected to ${where}. No turn recorded yet.` };
  }
  if (rows.some((r) => r.claudeCode === "partial" || r.claudeCode === "not-running")) return { ...base, state: "partial", line: "Partly connected. Open Agents to finish." };
  return { ...base, state: "not-connected", line: rows.length ? "Not connected to any project." : "Add a project first." };
}
