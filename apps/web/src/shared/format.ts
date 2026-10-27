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

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

/** For a save point that shares its second with another (a twin): which one it is, oldest first ("second", "12th"). "" otherwise. */
export function twinOrdinal(c: Stamped, peers: readonly Stamped[]): string {
  const n = distinctClocks(peers).get(c.id)?.nth ?? 0;
  if (!n) return "";
  return ORDINALS[n - 1] ?? `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

/**
 * A twin said in a sentence, its order before its time, so "second" can only mean the later of two beads with one time:
 * "the second save at 8:16:05 PM", "the second save on Mon 14 Oct at 8:16:05 PM" (Design 24 Oct P2-1). "" for a save point
 * that shares its second with none. Never "#N" in a sentence.
 */
function twinPhrase(c: Stamped, peers: readonly Stamped[], now: Date): string {
  const nth = twinOrdinal(c, peers);
  if (!nth) return "";
  const d = new Date(c.createdAt);
  const time = pointTime(c, peers);
  return d.toDateString() === now.toDateString() ? `the ${nth} save at ${time}` : `the ${nth} save on ${shortDay(d)} at ${time}`;
}

/** When a save point was made, said inside a sentence: "8:16 PM" (the day in front when not today), or a twin's `twinPhrase`. */
export function pointAt(c: Stamped, peers: readonly Stamped[], now = new Date()): string {
  return twinPhrase(c, peers, now) || pointWhen(c, peers, now);
}

/** A version named in a sentence: "the 8:16 PM version", or a twin's "the second save at 8:16:05 PM". */
export function versionPhrase(c: Stamped, peers: readonly Stamped[], now = new Date()): string {
  return twinPhrase(c, peers, now) || `the ${pointWhen(c, peers, now)} version`;
}

/** A version named by its time alone, for a heading whose title and meta line tell twins apart: "the 8:16:05 PM version". */
export function versionTimePhrase(c: Stamped, peers: readonly Stamped[], now = new Date()): string {
  const d = new Date(c.createdAt);
  if (Number.isNaN(d.getTime())) return `the ${pointWhen(c, peers, now)} version`;
  const time = pointTime(c, peers);
  return `the ${d.toDateString() === now.toDateString() ? time : `${shortDay(d)} ${time}`} version`;
}

/** A save point named in a sentence: "the save point from 8:16 PM", or a twin's "the second save at 8:16:05 PM". */
export function savePointPhrase(c: Stamped, peers: readonly Stamped[], now = new Date()): string {
  return twinPhrase(c, peers, now) || `the save point from ${pointWhen(c, peers, now)}`;
}

/** A phrase made to start a sentence: "the 8:16 PM version" becomes "The 8:16 PM version". */
export function sentenceStart(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A heading's time for a save point, without "#N", and for a twin the line under it that says which one: "The second save at 8:16:05 PM". */
export function sameSecondLine(c: Stamped, peers: readonly Stamped[], now = new Date()): { time: string; line: string } {
  return { time: pointTime(c, peers), line: sentenceStart(twinPhrase(c, peers, now)) };
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
  if (trigger === "recover") return "Before rewind";
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
