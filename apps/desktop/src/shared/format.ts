// Plain words and small formatting helpers shared by the app, the overlay and the preview.
import { APP_WORDS, type Verdict } from "@timetm/core/verdict";

export type VerdictKey = "pass" | "fail" | "incomplete" | "blocked" | "error" | "none";

const KEYS: Record<Verdict, VerdictKey> = { PASS: "pass", FAIL: "fail", INCOMPLETE: "incomplete", BLOCKED: "blocked", ERROR: "error" };

export function verdictKey(v: Verdict | null): VerdictKey {
  return v ? KEYS[v] : "none";
}

/** The fixed app word for a verdict. A save point with no verdict is "Not checked yet", never Works. */
export function verdictWord(v: Verdict | null): string {
  return APP_WORDS[v ?? "UNVERIFIED"];
}

/** Just the time of day, "10:42" or "8:16 PM" by locale. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "10:42" today, "Mon 10:42" otherwise. */
export function when(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const time = clock(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${day} ${time}`;
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown day";
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Who made a save point, from the engine's trigger field. */
export function triggerLabel(trigger: string): string {
  if (trigger.startsWith("claude-code:pre-bash")) return "Safety save";
  if (trigger.startsWith("claude-code")) return "Claude Code";
  if (trigger === "recover") return "Before rewind";
  if (trigger === "demo") return "Demo";
  if (trigger === "mcp") return "Agent";
  return "You";
}

/** One plain sentence on how a save point was made, from the engine's trigger field. */
export function triggerSentence(trigger: string): string {
  if (trigger === "claude-code:prompt") return "Saved by Claude Code before a prompt.";
  if (trigger === "claude-code:pre-bash") return "A safety save, made before a risky command.";
  if (trigger === "claude-code:stop") return "Saved by Claude Code when a turn ended.";
  if (trigger.startsWith("claude-code")) return "Saved by Claude Code.";
  if (trigger === "recover") return "Saved just before a rewind, so nothing was lost.";
  if (trigger === "mcp") return "Saved by an agent through the MCP server.";
  if (trigger === "app") return "Saved from the app.";
  if (trigger === "demo") return "Part of the demo story.";
  return "Saved with tm checkpoint.";
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
