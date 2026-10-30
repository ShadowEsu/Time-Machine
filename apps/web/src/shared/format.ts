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

/** Just the time of day, with seconds: "10:42:07" or "8:16:05 PM" by locale. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
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

/** A save point's distinct time: the `label` (with "#N" for twins), the `time` alone, and `nth`, its place among its twins (0 for none). */
interface Distinct {
  label: string;
  time: string;
  nth: number;
}

const distinctCache = new WeakMap<readonly Stamped[], Map<string, Distinct>>();

/**
 * Time labels that tell save points apart (GitLab Pajamas and Primer: show the exact time where order matters).
 * A save point alone in its minute reads "8:16 PM". Save points that share a minute read with seconds,
 * "8:16:05 PM". Save points that still share a second ("twins") add their number, "8:16:05 PM #7", and
 * know their place among the twins, oldest first.
 */
function distinctClocks(peers: readonly Stamped[]): Map<string, Distinct> {
  const cached = distinctCache.get(peers);
  if (cached) return cached;
  const perMinute = new Map<number, number>();
  const perSecond = new Map<number, Stamped[]>();
  for (const p of peers) {
    const t = Date.parse(p.createdAt);
    if (Number.isNaN(t)) continue;
    perMinute.set(Math.floor(t / 60_000), (perMinute.get(Math.floor(t / 60_000)) ?? 0) + 1);
    const twins = perSecond.get(Math.floor(t / 1000)) ?? [];
    twins.push(p);
    perSecond.set(Math.floor(t / 1000), twins);
  }
  for (const twins of perSecond.values()) twins.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const labels = new Map<string, Distinct>();
  for (const p of peers) {
    const t = Date.parse(p.createdAt);
    if (Number.isNaN(t)) continue;
    if ((perMinute.get(Math.floor(t / 60_000)) ?? 0) < 2) {
      const time = clock(p.createdAt);
      labels.set(p.id, { label: time, time, nth: 0 });
      continue;
    }
    const time = new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const twins = perSecond.get(Math.floor(t / 1000)) ?? [];
    const nth = twins.length > 1 ? twins.indexOf(p) + 1 : 0;
    const n = /(\d+)$/.exec(p.id)?.[1];
    labels.set(p.id, { label: nth && n ? `${time} #${Number(n)}` : time, time, nth });
  }
  distinctCache.set(peers, labels);
  return labels;
}

/** `clock` for a save point, distinct among `peers` (the project's save points). Keeps the "#N" of twins: for rulers, lists and ids, not sentences. */
export function pointClock(c: Stamped, peers: readonly Stamped[]): string {
  return distinctClocks(peers).get(c.id)?.label ?? clock(c.createdAt);
}

/** `pointClock` without the "#N": the time alone, for a heading or a readout that says which twin elsewhere. */
export function pointTime(c: Stamped, peers: readonly Stamped[]): string {
  return distinctClocks(peers).get(c.id)?.time ?? clock(c.createdAt);
}

function shortDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** `when` for a save point, distinct among `peers`: "8:16:05 PM" today, "Mon 14 Oct 8:16 PM" otherwise. */
export function pointWhen(c: Stamped, peers: readonly Stamped[], now = new Date()): string {
  const d = new Date(c.createdAt);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const time = pointClock(c, peers);
  if (d.toDateString() === now.toDateString()) return time;
  return `${shortDay(d)} ${time}`;
}

/** Notes a save point gets from how it was made, not from what it holds. They never name it; its time and number do. */
const MADE_NOTES: Record<string, true> = { "Auto save": true, "Saved by you": true, "After agent turn": true, "Saved before a check": true, "Saved to compare with now": true, "Saved when the app started": true, "First save point": true };

/** A message is quoted whole up to this many characters, then clipped, so a button or a heading keeps one line. */
const MESSAGE_MAX = 40;

/**
 * What a save point is named by: the name someone gave it (`given`), else the agent's prompt, else a note a person or an
 * agent wrote, else the commit's subject. "" when it has none: a safety save's command, an auto save, a save the app made.
 */
export function pointMessage(c: Titled & { subject?: string | null }, given = ""): string {
  if (given.trim()) return given.trim();
  if (c.trigger === "claude-code:pre-bash") return "";
  const prompt = c.agent?.prompt?.trim();
  if (prompt) return prompt.charAt(0).toUpperCase() + prompt.slice(1);
  const note = c.note.trim();
  if (note && !MADE_NOTES[note] && !/^Before recovering /.test(note)) return note;
  return c.subject?.trim() ?? "";
}

/** A save point's name, in two parts: its message in quotes and, secondary, its time ("“Added dark mode”", "2:58:48 AM").
 *  With no message, its time names it ("Save at 2:58:48 AM") and `time` is "". Times carry the day when not today. */
export interface PointName {
  name: string;
  time: string;
}

export function namePoint(c: Stamped, peers: readonly Stamped[], message: string, now = new Date()): PointName {
  const d = new Date(c.createdAt);
  const time = Number.isNaN(d.getTime()) ? "" : d.toDateString() === now.toDateString() ? pointTime(c, peers) : `${shortDay(d)} ${pointTime(c, peers)}`;
  const m = message.trim();
  if (m) return { name: `“${m.length > MESSAGE_MAX ? `${m.slice(0, MESSAGE_MAX - 1).trimEnd()}…` : m}”`, time };
  // No message: a readable name from its time ("Save at 2:58:48 AM"). Twins in one second keep their "#N" in the Inspector only.
  return { name: time ? `Save at ${time.replace(/ #\d+$/, "")}` : "A save with no time", time: "" };
}

/** The name on one line, for a label, a title or a heading: "“Added dark mode” · 2:58:48 AM", or "2:58:48 AM #3". */
export function nameLine(n: PointName): string {
  return n.time ? `${n.name} · ${n.time}` : n.name;
}

/** The name inside a sentence: "“Added dark mode” (2:58:48 AM)", or "the save at 2:58:48 AM". */
export function namePhrase(n: PointName): string {
  return n.time ? `${n.name} (${n.time})` : n.name.replace(/^Save at /, "the save at ");
}

/** A phrase made to start a sentence: "the save point at 8:16 PM #3" becomes "The save point at 8:16 PM #3". */
export function sentenceStart(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Another user's home, said by its usual shape: /Users/<name>, /home/<name> or C:\\Users\\<name>. Used when the server's own home is not known. */
const OTHER_HOME = String.raw`(?:\/Users|\/home)\/(?!Shared(?=[/"'\s<]|$))[^/\s"'\`<>&;:]+|\b[A-Za-z]:\\Users\\[^\\\s"'<>&]+`;
/** The home folders the server reported (as given and after realpath, so /var and /private/var both match), longest first. */
let homes: string[] = [];
const reEsc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Set once from the bootstrap: the server's home folder, as given and after realpath. */
export function setHomes(paths: readonly string[]): void {
  homes = [...new Set(paths.map((x) => x.replace(/[/\\]+$/, "")).filter((x) => x.length > 1))].sort((a, b) => b.length - a.length);
}
/** A home folder only where a path starts (start of text, after a space, a quote, a bracket, =, : or ;) and only up to a "/" or the path's end. Never in the middle of a path. */
function homeSource(): string {
  return `(?<![^\\s"'\`(<>=:;,])(?:${[...homes.map(reEsc), OTHER_HOME].join("|")})(?=[/\\\\\\s"'\`<>&;:),.]|$)`;
}
/** A path under the home folder, said with ~ ("~/code/tips"). A home name inside another path stays as it is. */
export function homePath(text: string): string {
  return text.replace(new RegExp(homeSource(), "g"), "~");
}

/**
 * `homePath` over a page's HTML before it is drawn, so every path on screen, in a tooltip or in the Inspector reads ~.
 * What a button acts on (data-path, data-text), what someone typed (a field's value, a textarea) and an example in a
 * placeholder keep the real path.
 */
export function homeHtml(html: string): string {
  const re = new RegExp(`(<textarea\\b[\\s\\S]*?</textarea>|\\b(?:data-path|data-text|value|placeholder)="[^"]*")|${homeSource()}`, "g");
  return html.replace(re, (_m, keep: string | undefined) => keep ?? "~");
}

/** Where a picked check came from, in plain words. `created` is false when timemachine.yml already existed. */
export function checkSource(command: string, created: boolean): string {
  if (!command) return "";
  if (!created) return "From your timemachine.yml.";
  const from: Record<string, string> = {
    "npm test": "From the test script in package.json.",
    "npm run build": "From the build script in package.json. There is no test script.",
    "cargo test": "From Cargo.toml.",
    "go test ./...": "From go.mod.",
    pytest: "From pyproject.toml or pytest.ini.",
  };
  return from[command] ?? "";
}

/** A journal day's name: "Today", "Yesterday", the weekday for the rest of the last 7 days ("Monday"), then the date ("14 Oct"; the year too when it is not this year). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown day";
  const ago = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago > 1 && ago < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  const date: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) date.year = "numeric";
  return d.toLocaleDateString(undefined, date);
}

/** Who made a save point, from the engine's trigger field. */
export function triggerLabel(trigger: string): string {
  if (trigger.startsWith("claude-code:pre-bash")) return "Safety save";
  if (trigger.startsWith("claude-code")) return "Claude Code";
  if (trigger === "recover") return "Before bring back";
  if (trigger === "before-restore") return "Before putting back";
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
  if (trigger === "recover") return "Saved just before a bring back, so nothing was lost.";
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
