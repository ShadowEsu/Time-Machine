// Corner card copy. A card may say "broke" only when it rests on a real FAIL, and shows
// green only when it rests on a real PASS. Shared by the overlay window and the preview.
import type { OverlayContent, Verdict } from "./api.js";
import { when } from "./format.js";

export interface CardPoint {
  id: string;
  verdict: Verdict | null;
  note: string;
  createdAt: string;
}

const INFO_MS = 8000;
const BROKEN_MS = 20000;

/**
 * The card for a new verdict on the newest save point, or null when there is nothing worth
 * saying. `before` is the verdict the newest save point had before this change, if any.
 */
export function verdictCard(projectId: string, projectName: string, points: CardPoint[], before: Verdict | null): Extract<OverlayContent, { kind: "card" }> | null {
  const newest = points.at(-1);
  if (!newest?.verdict) return null;
  const working = [...points].reverse().find((p) => p.id !== newest.id && p.verdict === "PASS") ?? null;
  const base = { kind: "card" as const, verdict: newest.verdict, projectName };
  switch (newest.verdict) {
    case "FAIL":
      if (working) {
        return {
          ...base,
          title: "Something broke after the last change.",
          body: `The last version that works is from ${when(working.createdAt)}: ${working.note}.`,
          primary: { label: `Go back to the ${when(working.createdAt)} version`, action: { kind: "rewind", projectId, target: working.id } },
          secondary: { label: "See what changed", action: { kind: "compare", projectId, a: working.id, b: newest.id } },
          hideAfterMs: BROKEN_MS,
        };
      }
      return {
        ...base,
        title: "This version doesn't pass its check.",
        body: "No earlier save point has passed yet, so there is nothing proven to go back to.",
        primary: { label: "Show what failed", action: { kind: "history", projectId, target: newest.id } },
        secondary: null,
        hideAfterMs: BROKEN_MS,
      };
    case "PASS":
      return {
        ...base,
        title: before === "FAIL" ? "Fixed. It works again." : "Still works.",
        body: `The ${when(newest.createdAt)} version, ${newest.note}, passed its check in a safe copy.`,
        primary: null,
        secondary: { label: "Show", action: { kind: "history", projectId, target: newest.id } },
        hideAfterMs: INFO_MS,
      };
    case "INCOMPLETE":
      return {
        ...base,
        title: "Couldn't check the last change.",
        body: "Something it needs was not saved. We won't call it working until we can check it.",
        primary: { label: "Show details", action: { kind: "history", projectId, target: newest.id } },
        secondary: null,
        hideAfterMs: INFO_MS,
      };
    case "BLOCKED":
      return {
        ...base,
        title: "The check needs something first.",
        body: "It could not run as set up. Open the save point to see what it needs.",
        primary: { label: "Show details", action: { kind: "history", projectId, target: newest.id } },
        secondary: null,
        hideAfterMs: INFO_MS,
      };
    case "ERROR":
      return {
        ...base,
        title: "The check crashed, not your project.",
        body: "This does not mean your project is broken. Open it to see the log.",
        primary: { label: "Show details", action: { kind: "history", projectId, target: newest.id } },
        secondary: null,
        hideAfterMs: INFO_MS,
      };
  }
}
