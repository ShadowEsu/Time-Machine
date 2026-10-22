// The project screen leads with one plain sentence and one next step. This decides both,
// from the save points alone, so the app, the tests and the palette always agree.
import type { TimelineEntry } from "@timetm/core";
import type { Verdict } from "../shared/api.js";
import { pointWhen, shortTitle, when } from "../shared/format.js";

export type StatusPoint = Pick<TimelineEntry, "id" | "verdict" | "createdAt" | "note" | "trigger" | "agent">;

/** A button on the project screen. `act` and the ids become data attributes the app already handles. */
export interface StatusButton {
  label: string;
  act: "rewind-to" | "rewind" | "compare" | "save" | "check";
  id?: string;
  a?: string;
  b?: string;
}

export interface ProjectStatusView {
  v: Verdict | null;
  head: string;
  /** The end of `head` set in italic, as an accent. Empty for none. */
  em: string;
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

/** `peers` are the project's save points, so two versions saved in the same minute never get the same label. */
export const goBackLabel = (c: StatusPoint, peers: readonly StatusPoint[]): string => `Go back to the ${pointWhen(c, peers)} version`;

/**
 * The status sentence and exactly one primary button, plus at most one secondary.
 * `checkedAt` is the time of a check that ran in this session, when there is one.
 */
export function projectStatus(points: StatusPoint[], checkedAt: string | null = null): ProjectStatusView {
  const newest = points.at(-1);
  const save: StatusButton = { label: "Save now", act: "save" };
  const check: StatusButton = { label: "Check it works", act: "check" };
  if (!newest) return { v: null, head: "No save points yet.", em: "", body: "Save now to make the first one. Then check that it works.", primary: save, secondary: null };
  const lw = lastWorking(points);
  const at = (c: StatusPoint): string => pointWhen(c, points);
  const goBack: StatusButton | null = lw ? { label: goBackLabel(lw, points), act: "rewind-to", id: lw.id } : null;
  switch (newest.verdict) {
    case "FAIL": {
      const em = `since ${at(brokenSince(points) ?? newest)}.`;
      const head = `Broken ${em}`;
      if (!lw) return { v: "FAIL", head, em, body: "No earlier version has passed a check yet. We can check older ones for you.", primary: { label: "Find the last working version", act: "rewind" }, secondary: null };
      return {
        v: "FAIL",
        head,
        em,
        body: `The last version that works is from ${at(lw)}: ${shortTitle(lw)}. Going back takes two clicks and saves this version first.`,
        primary: { label: goBackLabel(lw, points), act: "rewind-to", id: lw.id },
        secondary: { label: "See what changed", act: "compare", a: lw.id, b: "now" },
      };
    }
    case "PASS": {
      const em = checkedAt ? `checked at ${when(checkedAt)}.` : `as of ${at(newest)}.`;
      return {
        v: "PASS",
        head: `Works, ${em}`,
        em,
        body: `Your newest save point, ${at(newest)} ${shortTitle(newest)}, passed its check in a safe copy. Save again after your next change.`,
        primary: save,
        secondary: check,
      };
    }
    case "INCOMPLETE":
      return { v: "INCOMPLETE", head: "Couldn’t check the newest save point.", em: "", body: "We won’t call it working until a check finishes.", primary: check, secondary: goBack };
    case "BLOCKED":
      return { v: "BLOCKED", head: "Needs something before it can be checked.", em: "", body: "The check could not start. Check again after you add what it needs.", primary: check, secondary: goBack };
    case "ERROR":
      return { v: "ERROR", head: "The last check crashed.", em: "", body: "This is a problem with the check, not necessarily your project.", primary: check, secondary: goBack };
    default:
      return {
        v: null,
        head: "Not checked yet.",
        em: "checked yet.",
        body: `Saved at ${at(newest)}. We don’t know yet if this version works.`,
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
