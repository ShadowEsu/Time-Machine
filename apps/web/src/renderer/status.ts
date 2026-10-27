// The project screen leads with one plain sentence and one next step. This decides both,
// from the save points alone, so the app, the tests and the palette always agree.
import type { TimelineEntry } from "@timetm/core";
import type { Verdict } from "../shared/api.js";
import { pointAt, pointTime, sentenceStart, twinOrdinal, verdictWord, versionPhrase, when } from "../shared/format.js";

/**
 * The shapes History's ruler names. A project with no check and no verdict shows one neutral state, Saved. Otherwise the
 * three that are always there, then any other verdict among the save points shown.
 */
export function legendItems(checks: boolean, shown: readonly (Verdict | null)[]): { v: Verdict | null; word: string }[] {
  if (!checks && shown.every((v) => v === null)) return [{ v: null, word: "Saved" }];
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

export type StatusPoint = Pick<TimelineEntry, "id" | "verdict" | "createdAt" | "note" | "trigger" | "agent">;

/** A button on the project screen. `act` and the ids become data attributes the app already handles. */
export interface StatusButton {
  label: string;
  act: "rewind-to" | "rewind" | "compare" | "save" | "check";
  id?: string;
  a?: string;
  b?: string;
  /** The whole phrase, shown as a tooltip when the label is the short form ("Bring back 2:36 AM"). */
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

/** `peers` are the project's save points, so two versions saved in the same minute never get the same label, and two in one second are told apart by order. */
export const goBackLabel = (c: StatusPoint, peers: readonly StatusPoint[]): string => `Bring back ${versionPhrase(c, peers)}`;

/** The button form: "Bring back 2:36 AM". The time alone, with seconds only when another save point shares the minute,
 *  and a twin's order after it ("Bring back 2:36:56 AM (first save)"), never "#N". `goBackLabel` is its title. */
export function goBackShort(c: StatusPoint, peers: readonly StatusPoint[]): string {
  const nth = twinOrdinal(c, peers);
  return `Bring back ${pointTime(c, peers)}${nth ? ` (${nth} save)` : ""}`;
}

/** The go-back button: the short label on the face, the whole phrase in its title. */
const goBackButton = (c: StatusPoint, peers: readonly StatusPoint[]): StatusButton => ({ label: goBackShort(c, peers), act: "rewind-to", id: c.id, title: goBackLabel(c, peers) });

/**
 * The status sentence and exactly one primary button, plus at most one secondary.
 * `checkedAt` is the time of a check that ran in this session, when there is one.
 * `checks` is false for a folder that just saves versions (no check set, none ever ran): it never offers a check or calls a version working.
 */
export function projectStatus(points: StatusPoint[], checkedAt: string | null = null, checks = true): ProjectStatusView {
  const newest = points.at(-1);
  const save: StatusButton = { label: "Save now", act: "save" };
  const check: StatusButton = { label: "Check it works", act: "check" };
  if (!newest) return { v: null, head: "No save points yet.", voice: "", body: checks ? "Save now, then check that it works." : "Save now to keep the first version.", primary: save, secondary: null };
  // Times say the minute, and add the seconds only when another save point shares that minute, as the buttons do:
  // "the 9:48 AM version" must never name two versions. Two in one second add their order, "9:48:05 AM (second save)", never "#N".
  const said = (c: StatusPoint): string => pointAt(c, points);
  const savedAt = (c: StatusPoint): string => `Saved ${said(c)}.`;
  if (!checks && newest.verdict === null) {
    return { v: null, head: `Saved ${said(newest)}.`, voice: "", body: "Kept on this computer, outside the folder. Open any version to compare it or bring it back as a copy.", primary: save, secondary: null };
  }
  const lw = lastWorking(points);
  const goBack: StatusButton | null = lw ? goBackButton(lw, points) : null;
  const stillWorks = lw ? `${sentenceStart(versionPhrase(lw, points))} still works.` : "";
  switch (newest.verdict) {
    case "FAIL": {
      const since = brokenSince(points) ?? newest;
      const voice = `Since ${said(since)}.`;
      if (!lw) return { v: "FAIL", head: "Broken.", voice, body: "No earlier version has passed yet. We can check the older ones for you.", primary: { label: "Find the last working version", act: "rewind" }, secondary: null };
      return {
        v: "FAIL",
        head: "Broken.",
        voice,
        body: `${stillWorks} Bringing it back puts it on a new branch and in a recovery copy. Your folder is not touched.`,
        primary: goBackButton(lw, points),
        secondary: { label: "See what changed", act: "compare", a: lw.id, b: "now" },
      };
    }
    case "PASS":
      return {
        v: "PASS",
        head: "Works.",
        voice: checkedAt ? `Checked at ${when(checkedAt)}.` : savedAt(newest),
        body: "Your newest save point passed its check in a safe copy. Save again after your next change.",
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
        body: "Run your check in a safe copy to find out if this version works.",
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
