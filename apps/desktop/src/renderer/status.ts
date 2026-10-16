// The project screen leads with one plain sentence and one next step. This decides both,
// from the save points alone, so the app, the tests and the palette always agree.
import type { TimelineEntry } from "@timetm/core";
import type { Verdict } from "../shared/api.js";
import { when } from "../shared/format.js";

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
  body: string;
  primary: StatusButton;
  secondary: StatusButton | null;
}

/** What a save point is about, in the user's words: the agent prompt when there is one, else its note. */
export function shortTitle(c: StatusPoint): string {
  const prompt = c.agent?.prompt;
  return prompt && c.trigger !== "claude-code:pre-bash" ? prompt : c.note;
}

/**
 * A save point's title. Agent save points read like "Claude Code: add dark mode". When an author
 * line beside the title already names the agent, the title leaves the name out ("Add dark mode"),
 * so the agent shows once. Safety saves keep their command.
 */
export function pointTitle(c: Pick<StatusPoint, "note" | "trigger" | "agent">, author: string | null = null): string {
  const a = c.agent;
  if (!a?.prompt || c.trigger === "claude-code:pre-bash") return c.note;
  const before = c.trigger === "claude-code:prompt";
  if (author !== a.name) return before ? `Before ${a.name}: ${a.prompt}` : `${a.name}: ${a.prompt}`;
  return before ? `Before the prompt: ${a.prompt}` : a.prompt.charAt(0).toUpperCase() + a.prompt.slice(1);
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

export const goBackLabel = (c: StatusPoint): string => `Go back to the ${when(c.createdAt)} version`;

/**
 * The status sentence and exactly one primary button, plus at most one secondary.
 * `checkedAt` is the time of a check that ran in this session, when there is one.
 */
export function projectStatus(points: StatusPoint[], checkedAt: string | null = null): ProjectStatusView {
  const newest = points.at(-1);
  const save: StatusButton = { label: "Save now", act: "save" };
  const check: StatusButton = { label: "Check it works", act: "check" };
  if (!newest) return { v: null, head: "No save points yet.", body: "Save now to make the first one. Then check that it works.", primary: save, secondary: null };
  const lw = lastWorking(points);
  const goBack: StatusButton | null = lw ? { label: goBackLabel(lw), act: "rewind-to", id: lw.id } : null;
  switch (newest.verdict) {
    case "FAIL": {
      const head = `Broken since ${when((brokenSince(points) ?? newest).createdAt)}.`;
      if (!lw) return { v: "FAIL", head, body: "No earlier version has passed a check yet. We can check older ones for you.", primary: { label: "Find the last working version", act: "rewind" }, secondary: null };
      return {
        v: "FAIL",
        head,
        body: `The last version that works is from ${when(lw.createdAt)}: ${shortTitle(lw)}.`,
        primary: { label: goBackLabel(lw), act: "rewind-to", id: lw.id },
        secondary: { label: "See what changed", act: "compare", a: lw.id, b: "now" },
      };
    }
    case "PASS":
      return {
        v: "PASS",
        head: checkedAt ? `Works. Checked at ${when(checkedAt)}.` : `Works. The ${when(newest.createdAt)} version passed its check.`,
        body: "Your newest save point is a way back. Save again after your next change.",
        primary: save,
        secondary: check,
      };
    case "INCOMPLETE":
      return { v: "INCOMPLETE", head: "Couldn't check the newest save point.", body: "We won't call it working until a check finishes.", primary: check, secondary: goBack };
    case "BLOCKED":
      return { v: "BLOCKED", head: "Needs something before it can be checked.", body: "The check could not start. Check again after you add what it needs.", primary: check, secondary: goBack };
    case "ERROR":
      return { v: "ERROR", head: "The last check crashed.", body: "This is a problem with the check, not necessarily your project.", primary: check, secondary: goBack };
    default:
      return {
        v: null,
        head: "Not checked yet.",
        body: `Saved at ${when(newest.createdAt)}. We don't know yet if this version works.`,
        primary: check,
        secondary: goBack,
      };
  }
}
