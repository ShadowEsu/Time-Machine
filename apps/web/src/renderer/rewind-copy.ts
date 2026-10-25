// What going back does, said before anyone presses it, in the order the engine does it (recover.ts). A plain folder has
// no Git, so the engine makes no branch there: its steps and the "Go back anyway" confirm never mention one (Design gate MF2).
import type { Verdict } from "../shared/api.js";
import { esc } from "../shared/format.js";

/** The Review step's main key. */
export type ReviewKey = "bring-back" | "copy" | "try" | "try-again";

/** What each key does: tv-use brings the version back (recover), tv-try runs the check on it in a safe copy. */
export const REVIEW_KEY: Record<ReviewKey, { act: "tv-use" | "tv-try"; label: string }> = {
  "bring-back": { act: "tv-use", label: "Bring it back" },
  copy: { act: "tv-use", label: "Bring it back as a copy" },
  try: { act: "tv-try", label: "Try it first" },
  "try-again": { act: "tv-try", label: "Try it again" },
};

/**
 * The key for a version. A project with no check (`checks` false) only saves versions: its key brings the version back
 * as a copy, with no check run and no verdict stored, whatever an old verdict says (Design gate MF4). With a check, a
 * passed version comes back; any other is tried in a safe copy first.
 */
export function reviewKey(checks: boolean, verdict: Verdict | null, tried: boolean): ReviewKey {
  if (!checks) return "copy";
  if (verdict === "PASS") return "bring-back";
  return tried ? "try-again" : "try";
}

/** The steps and the safe line on the rewind sheet. `gitDetails` adds the branch name for a Git project. */
export function goBackSteps({ folder, id, gitDetails }: { folder: boolean; id: string; gitDetails: boolean }): string {
  const steps = folder
    ? ["<b>We save your current version first,</b> so nothing is lost.", "<b>We build a recovery copy</b> next to your folder."]
    : [
        "<b>We save your current version first,</b> so nothing is lost.",
        `<b>We put this version on a new local branch</b>${gitDetails ? `, <span class="mono">tm/recover/${esc(id)}</span>` : ""}.`,
        "<b>We build a recovery copy</b> next to your project folder.",
      ];
  const safe = folder ? "<b>Nothing is deleted. Your folder is not touched.</b> You can undo it." : "<b>Nothing is pushed, merged, deployed or deleted. Your folder and branch are not touched.</b> You can undo it.";
  return `<ol class="rw-steps" aria-label="When you go back, we">
      ${steps.map((s) => `<li><span>${s}</span></li>`).join("\n      ")}
    </ol>
    <p class="rw-safe">${safe}</p>`;
}

/** The "Go back anyway" confirm's body: why it may not work, then what going back does. */
export function anywayBody(why: string, folder: boolean): string {
  return folder
    ? `${why} We save your current version first. Your folder is not touched, and you can undo it.`
    : `${why} We save your current version first and put this one on a new local branch. Your folder and branch are not touched, and you can undo it.`;
}
