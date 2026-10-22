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

/** What a save point label needs: its id ("cp-0007") and when it was made. */
export interface Stamped {
  id: string;
  createdAt: string;
}

const distinctCache = new WeakMap<readonly Stamped[], Map<string, string>>();

/**
 * Time labels that tell save points apart (GitLab Pajamas and Primer: show the exact time where order matters).
 * A save point alone in its minute reads "8:16 PM". Save points that share a minute read with seconds,
 * "8:16:05 PM". Save points that still share a second add their number, "8:16:05 PM #7".
 */
function distinctClocks(peers: readonly Stamped[]): Map<string, string> {
  const cached = distinctCache.get(peers);
  if (cached) return cached;
  const perMinute = new Map<number, number>();
  const perSecond = new Map<number, number>();
  for (const p of peers) {
    const t = Date.parse(p.createdAt);
    if (Number.isNaN(t)) continue;
    perMinute.set(Math.floor(t / 60_000), (perMinute.get(Math.floor(t / 60_000)) ?? 0) + 1);
    perSecond.set(Math.floor(t / 1000), (perSecond.get(Math.floor(t / 1000)) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const p of peers) {
    const t = Date.parse(p.createdAt);
    if (Number.isNaN(t)) continue;
    if ((perMinute.get(Math.floor(t / 60_000)) ?? 0) < 2) {
      labels.set(p.id, clock(p.createdAt));
      continue;
    }
    const withSeconds = new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const n = /(\d+)$/.exec(p.id)?.[1];
    labels.set(p.id, (perSecond.get(Math.floor(t / 1000)) ?? 0) > 1 && n ? `${withSeconds} #${Number(n)}` : withSeconds);
  }
  distinctCache.set(peers, labels);
  return labels;
}

/** `clock` for a save point, distinct among `peers` (the project's save points). */
export function pointClock(c: Stamped, peers: readonly Stamped[]): string {
  return distinctClocks(peers).get(c.id) ?? clock(c.createdAt);
}

/** `when` for a save point, distinct among `peers`: "8:16:05 PM" today, "Mon 14 Oct 8:16 PM" otherwise. */
export function pointWhen(c: Stamped, peers: readonly Stamped[], now = new Date()): string {
  const d = new Date(c.createdAt);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const time = pointClock(c, peers);
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${time}`;
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

/** The parts of a save point its title comes from. */
export interface Titled {
  note: string;
  trigger: string;
  agent?: { name: string; prompt?: string } | null;
}

/** What a save point is about, in the user's words: the agent prompt when there is one, else its note. */
export function shortTitle(c: Titled): string {
  const prompt = c.agent?.prompt;
  return prompt && c.trigger !== "claude-code:pre-bash" ? prompt : c.note;
}

/**
 * A save point's title. Agent save points read like "Claude Code: add dark mode". When an author
 * line beside the title already names the agent, the title leaves the name out ("Add dark mode"),
 * so the agent shows once. Safety saves keep their command.
 */
export function pointTitle(c: Titled, author: string | null = null): string {
  const a = c.agent;
  if (!a?.prompt || c.trigger === "claude-code:pre-bash") return c.note;
  const before = c.trigger === "claude-code:prompt";
  if (author !== a.name) return before ? `Before ${a.name}: ${a.prompt}` : `${a.name}: ${a.prompt}`;
  return before ? `Before the prompt: ${a.prompt}` : a.prompt.charAt(0).toUpperCase() + a.prompt.slice(1);
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
