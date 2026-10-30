// The agent channel: Claude Code, read from its hook lines and the audit log. Other agents are not built yet; the app
// says "Codex and Cursor: planned" once, quietly, and connects none of them. No activity is ever invented.
import type { AgentRow } from "../shared/api.js";
import { plural, when } from "../shared/format.js";

export interface Channel {
  name: string;
  state: "working" | "idle" | "partial" | "not-connected";
  /** One plain sentence. */
  line: string;
  /** The rail's status line under the name: "Connected to tips", "Not connected". */
  short: string;
}

/**
 * Claude Code's channel from the hook state of each project. `lastEnded` maps a project id to the
 * time of its newest "agent-turn ended" audit line, when one was read.
 */
export function claudeChannel(rows: AgentRow[], lastEnded: ReadonlyMap<string, string>, now = new Date()): Channel {
  const base = { name: "Claude Code" };
  const working = rows.filter((r) => r.working);
  if (working.length) {
    const first = working[0];
    const since = first?.workingSince ? ` since ${when(first.workingSince, now)}` : "";
    const where = working.length === 1 ? `in ${first?.name ?? ""}` : `in ${plural(working.length, "project")}`;
    return { ...base, state: "working", line: `Working ${where}${since}.`, short: `Working ${where}` };
  }
  const connected = rows.filter((r) => r.claudeCode === "connected");
  if (connected.length) {
    const ended = connected
      .map((r) => ({ name: r.name, at: lastEnded.get(r.projectId) }))
      .filter((x): x is { name: string; at: string } => !!x.at)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    const where = connected.length === 1 ? (connected[0]?.name ?? "") : plural(connected.length, "project");
    return { ...base, state: "idle", line: ended ? `Idle. Last turn ended ${when(ended.at, now)} in ${ended.name}.` : `Connected to ${where}. No turn recorded yet.`, short: `Connected to ${where}` };
  }
  if (rows.some((r) => r.claudeCode === "partial" || r.claudeCode === "not-running" || r.claudeCode === "needs-approval")) return { ...base, state: "partial", line: "Partly connected. Open Agents to finish.", short: "Needs setup" };
  return { ...base, state: "not-connected", line: rows.length ? "Not connected to any project." : "Add a project first.", short: "Not connected" };
}
