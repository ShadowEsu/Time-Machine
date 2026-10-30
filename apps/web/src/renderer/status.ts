// The project screen leads with one plain sentence and one next step. This decides both,
// from the save points alone, so the app, the tests and the palette always agree.
import type { TimelineEntry } from "@timetm/core";
import type { Verdict } from "../shared/api.js";
import { nameLine, namePhrase, namePoint, pointMessage, sentenceStart, verdictWord, when } from "../shared/format.js";

/**
 * The shapes History's ruler names. A project with no check and no verdict shows one neutral state, Saved. Otherwise the
 * three that are always there, then any other verdict among the save points shown.
 */
export function legendItems(checks: boolean, shown: readonly (Verdict | null)[]): { v: Verdict | null; word: string }[] {
  // No check now: old verdicts stay in the legend as history, and a save point with none is "Saved", never "Not checked yet".
  if (!checks) return [...(["PASS", "FAIL", "INCOMPLETE", "BLOCKED", "ERROR"] as const).filter((v) => shown.includes(v)).map((v) => ({ v, word: verdictWord(v) })), { v: null, word: "Saved" }];
  const extra = (["INCOMPLETE", "BLOCKED", "ERROR"] as const).filter((v) => shown.includes(v));
  return [...(["PASS", "FAIL", null] as const), ...extra].map((v) => ({ v, word: verdictWord(v) }));
}

/** A journal time, "2:43:36 AM #3", as the time that stays whole and the same-second ordinal that may sit below it. */
export function clockParts(t: string): { time: string; ord: string } {
  const m = /^(.*?)(?:\s+(#\d+))?$/.exec(t.trim());
  return { time: m?.[1] ?? t, ord: m?.[2] ?? "" };
}

/** How long ago, in the rail's plain words: "just now", "3 min", "2 h" (today), "Yesterday", "4 days", then the date. */
export function railAge(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const m = Math.max(0, Math.floor((now - at.getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((today.getTime() - at.getTime()) / 86_400_000);
  if (days <= 0) return `${Math.floor(m / 60)} h`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days`;
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export type StatusPoint = Pick<TimelineEntry, "id" | "verdict" | "createdAt" | "note" | "trigger" | "agent" | "subject">;

/** What names a save point: its message. By default the save point's own; the app adds the names people give. */
export type MessageOf = (c: StatusPoint) => string;
const ownMessage: MessageOf = (c) => pointMessage(c);

/** A button on the project screen. `act` and the ids become data attributes the app already handles. */
export interface StatusButton {
  label: string;
  act: "rewind-to" | "rewind" | "compare" | "save" | "check";
  id?: string;
  a?: string;
  b?: string;
  /** Said after the label, quieter: the time of the save point the label names by its message. */
  sub?: string;
  /** The whole name, for a tooltip and a screen reader: "Bring back “Added dark mode” · 2:58:48 AM". */
  title?: string;
}

export interface ProjectStatusView {
  v: Verdict | null;
  /** The status, said once in the display face: "Works.", "Broken.", "Not checked yet.", "Saved 7:33 AM." */
  head: string;
  /** The time it holds for, said once as quiet text under the head: "Saved 7:33 AM." Empty when the head already says it. */
  voice: string;
  /** One sentence that adds something: what it means or what to do next. Never the time again. */
  body: string;
  primary: StatusButton;
  secondary: StatusButton | null;
}

/** The newest save point that passed its check, other than the newest one. */
export function lastWorking<T extends StatusPoint>(points: T[]): T | null {
  const newest = points.at(-1);
  return [...points].reverse().find((c) => c.verdict === "PASS" && c.id !== newest?.id) ?? null;
}

/** The first save point proven broken after the last one that worked. */
export function brokenSince<T extends StatusPoint>(points: T[]): T | null {
  const lastPass = points.map((c) => c.verdict).lastIndexOf("PASS");
  return points.slice(lastPass + 1).find((c) => c.verdict === "FAIL") ?? null;
}

/** The go-back action's whole name, for a tooltip or a screen reader: "Bring back “Added dark mode” · 2:58:48 AM". */
export const goBackLabel = (c: StatusPoint, peers: readonly StatusPoint[], message: MessageOf = ownMessage): string => `Bring back ${nameLine(namePoint(c, peers, message(c)))}`;

/** The go-back button: "Bring back “Added dark mode”" with its time beside it, quieter; with no message, "Bring back 2:58:48 AM #3". */
function goBackButton(c: StatusPoint, peers: readonly StatusPoint[], message: MessageOf): StatusButton {
  const n = namePoint(c, peers, message(c));
  return { label: `Bring back ${n.name}`, ...(n.time ? { sub: n.time } : {}), act: "rewind-to", id: c.id, title: `Bring back ${nameLine(n)}` };
}

/**
 * The status sentence and exactly one primary button, plus at most one secondary.
 * `checkedAt` is the time of a check that ran in this session, when there is one.
 * `checks` is false for a folder that just saves versions (no check set, none ever ran): it never offers a check or calls a version working.
 * `message` names a save point; the app passes one that knows the names people gave.
 */
export function projectStatus(points: StatusPoint[], checkedAt: string | null = null, checks = true, message: MessageOf = ownMessage): ProjectStatusView {
  const newest = points.at(-1);
  const save: StatusButton = { label: "Save now", act: "save" };
  const check: StatusButton = { label: "Check it works", act: "check" };
  if (!newest) return { v: null, head: "No save points yet.", voice: "", body: checks ? "Save now, then check that it works." : "Save now to keep the first version.", primary: save, secondary: null };
  // A save point is named by its message, the time after it; with no message, by its time and number ("2:58:48 AM #3").
  const said = (c: StatusPoint): string => namePhrase(namePoint(c, points, message(c)));
  const savedAt = (c: StatusPoint): string => {
    const n = namePoint(c, points, message(c));
    return n.time ? `Saved ${n.name} at ${n.time}.` : `Saved at ${n.name}.`;
  };
  if (!checks && newest.verdict === null) {
    return { v: null, head: savedAt(newest), voice: "", body: "Kept on this computer, outside the folder. Open any version to compare it or bring it back as a copy.", primary: save, secondary: null };
  }
  const lw = lastWorking(points);
  const goBack: StatusButton | null = lw ? goBackButton(lw, points, message) : null;
  const stillWorks = lw ? `${sentenceStart(said(lw))} still works.` : "";
  switch (newest.verdict) {
    case "FAIL": {
      const since = brokenSince(points) ?? newest;
      const voice = `Since ${said(since)}.`;
      if (!lw) return { v: "FAIL", head: "Broken.", voice, body: "No earlier version has passed yet. We can check the older ones for you.", primary: { label: "Find the last working version", act: "rewind" }, secondary: null };
      return {
        v: "FAIL",
        head: "Broken.",
        voice,
        body: `${stillWorks} Bringing it back puts it on a new branch and in a copy. Your folder is not touched.`,
        primary: goBackButton(lw, points, message),
        secondary: { label: "See what changed", act: "compare", a: lw.id, b: "now" },
      };
    }
    case "PASS":
      return {
        v: "PASS",
        head: "Works.",
        voice: checkedAt ? `Checked at ${when(checkedAt)}.` : savedAt(newest),
        body: "Your newest save point passed its check in a copy. Save again after your next change.",
        primary: save,
        secondary: check,
      };
    case "INCOMPLETE":
      return { v: "INCOMPLETE", head: "Couldn’t check.", voice: savedAt(newest), body: `The check did not finish, so we won’t call it working.${lw ? ` ${stillWorks}` : " Check again to finish it."}`, primary: check, secondary: goBack };
    case "BLOCKED":
      return { v: "BLOCKED", head: "Needs something first.", voice: savedAt(newest), body: `The check could not start. Add what it needs, then check again.${lw ? ` ${stillWorks}` : ""}`, primary: check, secondary: goBack };
    case "ERROR":
      return { v: "ERROR", head: "The check crashed.", voice: savedAt(newest), body: `This is a problem with the check, not necessarily your project.${lw ? ` ${stillWorks}` : ""}`, primary: check, secondary: goBack };
    default:
      return {
        v: null,
        head: "Not checked yet.",
        voice: savedAt(newest),
        body: "Run your check in a copy to find out if this version works.",
        primary: check,
        secondary: goBack,
      };
  }
}

/**
 * How many checks in a row passed for each save point, newest last, from the audit log's "verify" lines
 * (oldest first). A check that did not pass starts the count again; a stopped check proves nothing and
 * leaves it as it was. "3 checks passed" is only said when the last three checks all passed.
 */
export function passStreaks(entries: readonly { action: string; target: string | null; result: string }[]): Map<string, number> {
  const streaks = new Map<string, number>();
  for (const e of entries) {
    if (e.action !== "verify" || !e.target) continue;
    streaks.set(e.target, e.result === "PASS" ? (streaks.get(e.target) ?? 0) + 1 : 0);
  }
  return streaks;
}

/** True for an engine reason that says a save point failed its integrity check: it is damaged, not a check that crashed. */
export function isDamagedReason(reason: string): boolean {
  return /failed its integrity check|is missing from this repository|gone from the store/i.test(reason);
}

/** The engine's reason as the app says it. "No check is set up" for a Git project names the file and key for the tm
 *  command line (packages/core/src/verify.ts); the app points to its own place for a check instead. */
export function checkReason(reason: string): string {
  return /^No check is set up\. Add verify\.command to timemachine\.yml\b/.test(reason) ? "No check is set up yet. Set one in Settings, under Check." : reason;
}

/**
 * The sentence that says why a save point is damaged, or null when it is whole. From the engine's `damaged` field when it
 * sends one; else from the shape an unreadable save point has in the timeline (no time, no trigger, the reason as its note).
 */
export function damagedReason(c: Pick<TimelineEntry, "createdAt" | "trigger" | "note" | "verdict"> & { damaged?: string }): string | null {
  if (c.damaged) return c.damaged;
  if (!c.createdAt && !c.trigger && c.verdict === "ERROR") return c.note || "This save point can’t be read.";
  return null;
}

/** What one save point changed since the one before it, by kind, as the diff reports it. */
export interface ChangeKinds {
  added: readonly string[];
  removed: readonly string[];
  changed: readonly string[];
}

/** Files the system writes on its own: never the news of a save point. */
const OS_JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$/;
const VERB: { [K in keyof ChangeKinds]: string } = { removed: "deleted", added: "added", changed: "changed" };

/**
 * A save point's change in a few words, the biggest event first, grouped by top folder: "309 files deleted",
 * "300 added in notes/, chapter-2.md changed, chapter-3.md deleted and 1 more". A single file is named. Empty when
 * nothing changed. The diff has no renames, so a rename reads as one deleted and one added.
 */
export function changeSummary(k: ChangeKinds): string {
  const kinds = (["removed", "added", "changed"] as const).map((kind) => ({ kind, paths: k[kind].filter((f) => !OS_JUNK.test(f)) }));
  const total = kinds.reduce((n, x) => n + x.paths.length, 0);
  if (!total) return "";
  const base = (f: string): string => f.split("/").filter(Boolean).at(-1) ?? f;
  const top = (f: string): string => (f.includes("/") ? `${f.split("/")[0]}/` : "");
  const used = kinds.filter((x) => x.paths.length);
  const [only] = used;
  if (used.length === 1 && only) {
    const verb = VERB[only.kind];
    const [first] = only.paths;
    if (only.paths.length === 1 && first) return `${base(first)} ${verb}`;
    const folders = new Set(only.paths.map(top));
    const [folder] = folders;
    return `${only.paths.length} files ${verb}${folders.size === 1 && folder ? ` in ${folder}` : ""}`;
  }
  // One event per kind and top folder, biggest first; equal sizes keep the order deleted, added, changed.
  const events: { kind: keyof ChangeKinds; folder: string; paths: string[] }[] = [];
  for (const { kind, paths } of used) {
    for (const f of paths) {
      const folder = top(f);
      const e = events.find((x) => x.kind === kind && x.folder === folder);
      if (e) e.paths.push(f);
      else events.push({ kind, folder, paths: [f] });
    }
  }
  events.sort((a, b) => b.paths.length - a.paths.length);
  const said = events.slice(0, 3).map((e) => {
    const [first] = e.paths;
    return e.paths.length === 1 && first ? `${base(first)} ${VERB[e.kind]}` : `${e.paths.length} ${VERB[e.kind]}${e.folder ? ` in ${e.folder}` : ""}`;
  });
  const rest = events.slice(3).reduce((n, e) => n + e.paths.length, 0);
  return rest ? `${said.join(", ")} and ${rest} more` : said.join(", ");
}

/** Save points newest first by when they were made; equal times keep the newer id first. For the journal's day groups. */
export function newestByTime<T extends { createdAt: string }>(points: readonly T[]): T[] {
  return points.map((c, i) => ({ c, i, t: Date.parse(c.createdAt) })).sort((a, b) => b.t - a.t || b.i - a.i).map((x) => x.c);
}

/** What the Git details line needs from a save point. `subject` is the HEAD commit's subject, when the engine read it. */
export type GitPoint = Pick<TimelineEntry, "id" | "head" | "branch" | "coverage"> & { subject?: string | null };

/** How many tracked files had changes not committed yet ("including 2 uncommitted changes"); untracked files never count (dev#38). */
export function uncommittedCount(c: Pick<TimelineEntry, "coverage">): number {
  for (const l of c.coverage.captured) {
    const m = l.startsWith("Code:") ? /including (\d+) uncommitted/.exec(l) : null;
    if (m?.[1]) return Number(m[1]);
  }
  return 0;
}

/**
 * The Git details line for a row: the person's own HEAD, never the snapshot commit Time Machine made ("main · 497e8b8
 * Tweak discount tier 29 + 2 uncommitted", "detached at e5dd44b"). A plain folder has no Git of its own: only the id.
 */
export function gitLine(c: GitPoint, kind: "git" | "folder"): string {
  if (kind === "folder" || !c.head) return c.id;
  const sha = c.head.slice(0, 7);
  const where = c.branch ? `${c.branch} · ${sha}` : `detached at ${sha}`;
  const n = uncommittedCount(c);
  return `${where}${c.subject ? ` ${c.subject}` : ""}${n ? ` + ${n} uncommitted` : ""}`;
}

/** The branch a row was saved on, when it differs from the save point before it: "on feature/x", "detached at e5dd44b". Else "". */
export function branchShift(c: Pick<TimelineEntry, "branch" | "head">, before: Pick<TimelineEntry, "branch" | "head"> | undefined, kind: "git" | "folder"): string {
  if (kind === "folder" || !before || !c.head || c.branch === before.branch) return "";
  return c.branch ? `on ${c.branch}` : `detached at ${c.head.slice(0, 7)}`;
}
