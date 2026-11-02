// What bringing a version back does, said before anyone presses it, in the order the engine does it (recover.ts). A plain folder
// has no Git, so the engine makes no branch there: its steps and the "Bring it back anyway" confirm never mention one (Design gate MF2).
import type { Verdict } from "../shared/api.js";
import { esc, sentenceStart } from "../shared/format.js";

/** The Review step's main key. */
export type ReviewKey = "bring-back" | "copy" | "try" | "try-again";

/** What each key does: tv-use brings the version back (recover), tv-try runs the check on it in a copy. */
export const REVIEW_KEY: Record<ReviewKey, { act: "tv-use" | "tv-try"; label: string }> = {
  "bring-back": { act: "tv-use", label: "Bring it back" },
  copy: { act: "tv-use", label: "Bring it back as a copy" },
  try: { act: "tv-try", label: "Try it first" },
  "try-again": { act: "tv-try", label: "Try it again" },
};

/**
 * The key for a version. A project with no check (`checks` false) only saves versions: its key brings the version back
 * as a copy, with no check run and no verdict stored, whatever an old verdict says (Design gate MF4). With a check, a
 * passed version comes back; any other is tried in a copy first.
 */
export function reviewKey(checks: boolean, verdict: Verdict | null, tried: boolean): ReviewKey {
  if (!checks) return "copy";
  if (verdict === "PASS") return "bring-back";
  return tried ? "try-again" : "try";
}

/** The steps and the safe line on the rewind sheet. `gitDetails` adds the branch name for a Git project. */
export function goBackSteps({ folder, id, gitDetails }: { folder: boolean; id: string; gitDetails: boolean }): string {
  const steps = folder
    ? ["<b>We save your current version first,</b> so nothing is lost.", "<b>We build a copy</b> next to your folder."]
    : [
        "<b>We save your current version first,</b> so nothing is lost.",
        `<b>We put this version on a new local branch</b>${gitDetails ? `, <span class="mono">tm/recover/${esc(id)}</span>` : ""}.`,
        "<b>We build a copy</b> next to your project folder.",
      ];
  const safe = folder ? "<b>Nothing is deleted. Your folder is not touched.</b> You can undo it." : "<b>Nothing is pushed, merged, deployed or deleted. Your folder and branch are not touched.</b> You can undo it.";
  return `<ol class="rw-steps" aria-label="When you bring it back, we">
      ${steps.map((s) => `<li><span>${s}</span></li>`).join("\n      ")}
    </ol>
    <p class="rw-safe">${safe}</p>`;
}

/** The "Bring it back anyway" confirm's body: why it may not work, then what bringing it back does. */
export function anywayBody(why: string, folder: boolean): string {
  return folder
    ? `${why} We save your current version first. Your folder is not touched, and you can undo it.`
    : `${why} We save your current version first and put this one on a new local branch. Your folder and branch are not touched, and you can undo it.`;
}

/** What a version's recorded verdict says about it, in one line, when it is not proven to work. */
const UNPROVEN: Record<Exclude<Verdict, "PASS">, string> = {
  FAIL: "This version failed its check, so it may not work.",
  INCOMPLETE: "Its check didn’t finish, so it isn’t proven to work.",
  BLOCKED: "Its check couldn’t start, so it isn’t proven to work.",
  ERROR: "Its check crashed, so it isn’t proven to work.",
};

/**
 * The bring back confirm's one extra line for a version that isn't proven: never checked, or a check that failed or did not
 * finish. None for a version that passed, and none for a project with no check, which only saves versions (Design gate MF4).
 */
export function unprovenLine(checks: boolean, verdict: Verdict | null): string | null {
  if (!checks || verdict === "PASS") return null;
  return verdict ? UNPROVEN[verdict] : "This version hasn’t been checked, so we don’t know if it works.";
}

/**
 * Where a bring back opens. The one confirm, for a version already chosen. The dial stays only for a project whose folder is
 * missing or when the save point you were on is damaged: then there is no version in hand, and the dial is how to choose one.
 */
export function bringBackView({ folderMissing, damaged }: { folderMissing: boolean; damaged: boolean }): "confirm" | "dial" {
  return folderMissing || damaged ? "dial" : "confirm";
}

/** History's banner after a bring back (B4): what it shows, from the recover result or, after a reload, the engine's list. */
export interface AfterView {
  /** The version inside a sentence: "“Added dark mode” (8:03:18 AM)". */
  name: string;
  /** The branch the engine made; "" for a plain folder, which gets a copy only. */
  branch: string;
  /** The copy's full path, "" when it is not there anymore. The page shows it from ~ (homeHtml); Show in Finder keeps it whole. */
  copyDir: string;
  /** Undo and Keep it are offered: a bring back this tm ui made, not kept or undone yet. */
  open: boolean;
  /** Undo is running. */
  working: boolean;
  /** Something else is running: the choices wait. */
  busy: boolean;
  /** Undo's shortcut, as this computer writes it ("⌘Z"). */
  undoKey: string;
  /** Show in Finder, in this computer's words. */
  reveal: string;
  /** The version Check this version checks, in a copy of its own; null for a project with no check. */
  checkId: string | null;
  /** That version already passed its check: no button to check it again here (the status says it works). */
  proven?: boolean;
  /** The broken version saved before going back, as History names it, so the banner can take you to its row. */
  broken: { id: string; title: string } | null;
}

/**
 * A banner, not a toast: nothing about it goes away on its own. It says where the working version went (the branch and the
 * copy) and, once, that your folder was not touched, with Show in Finder and Check this version (unless it already passed); links your broken version's
 * row; and, while it is open, Undo (always in view, with its shortcut) and Keep it, each with what it does under it.
 */
export function afterBanner(v: AfterView): string {
  const off = v.busy || v.working ? " disabled" : "";
  const mono = (s: string): string => `<span class="mono sel-text">${esc(s)}</span>`;
  const where = v.branch && v.copyDir ? `It is on ${v.open ? "the new" : "the"} branch ${mono(v.branch)}, with a copy at ${mono(v.copyDir)}.`
    : v.branch ? `It is on the branch ${mono(v.branch)}. Its copy is not there anymore.`
    : v.copyDir ? `It is in a copy at ${mono(v.copyDir)}.`
    : "Its copy is not there anymore.";
  const tries = [
    v.copyDir ? `<button class="btn quiet" data-act="reveal-dir" data-path="${esc(v.copyDir)}">${esc(v.reveal)}</button>` : "",
    !v.open && v.branch ? `<button class="btn quiet" data-act="copy" data-text="${esc(v.branch)}" aria-label="Copy branch name ${esc(v.branch)}">Copy branch name</button>` : "",
    // Named for its own target: the header's Check it works checks the folder (Design #72 M1).
    v.checkId && !v.proven ? `<button class="btn quiet" data-act="verify-one" data-id="${esc(v.checkId)}"${off}>Check this version</button>` : "",
  ].join("");
  // The row is named in the sentence; the link under it says where it goes.
  const broken = v.broken
    ? `<div class="after-broken"><p><b>Your broken version is safe.</b> It is saved in History as “${esc(v.broken.title)}”.</p><button class="btn link" data-act="pick" data-id="${esc(v.broken.id)}">Show it in History</button></div>`
    : "";
  const what = v.branch ? "the copy and the branch" : "the copy";
  const choices = v.open
    ? `<div class="after-ch">
      <div class="after-c"><button class="btn" data-act="undo-rewind" data-key="undo" aria-describedby="after-undo-d"${off}>${v.working ? "Undoing…" : "Undo this bring back"}<kbd>${esc(v.undoKey)}</kbd></button><small id="after-undo-d">Removes ${what}. Every save point stays.</small></div>
      <div class="after-c"><button class="btn quiet" data-act="undo-dismiss" aria-describedby="after-keep-d"${off}>Keep it</button><small id="after-keep-d">Keeps ${what}. Undo goes away.</small></div>
    </div>`
    : "";
  // Undo and Keep it come right after where it went, so Undo is in view from the first frame, on a phone too (B6 S10, §3.3).
  return `<section class="after${v.open ? "" : " kept"}" aria-labelledby="after-h">
    <h2 class="after-h" id="after-h" tabindex="-1">${esc(sentenceStart(v.open ? `${v.name} is back, in a copy` : `${v.name} was brought back`))}</h2>
    <p class="after-where">${where} Your folder was not touched.</p>
    ${choices}${tries ? `<div class="row-btns after-try">${tries}</div>` : ""}${broken}
  </section>`;
}

/** The sidebar's line for a project: its verdict, and while a bring back is open (not kept or undone), that a working copy is ready. */
export function railLine(word: string, ready: boolean): string {
  return ready ? `${word} · copy ready` : word;
}

/** What the polite live region says after Undo, from what the engine reports it removed (Design #72 M2). */
export function undoneLine(r: { removedBranch: string; removedCopy: string | null }): string {
  if (r.removedBranch && r.removedCopy) return "Undone. The copy and branch are removed.";
  if (r.removedCopy) return "Undone. The copy is removed.";
  return r.removedBranch ? "Undone. The branch is removed; its copy was already gone." : "Undone. Its copy was already gone.";
}
