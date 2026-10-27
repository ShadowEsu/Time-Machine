// The Add flow: what to protect, then the folder, then a check (required for code, optional for the rest), then
// when to save. The words and choices are decided here, from the purpose alone, so the window and the tests agree.
import type { AutoSave, ProjectKind, Purpose } from "../shared/api.js";
import { esc, plural } from "../shared/format.js";
import { ADD_PURPOSES, checkRecommended, PURPOSES, purposeIcon } from "./purpose.js";

export type AddStep = 1 | 2 | 3 | 4;
/** One word each, so the stepper stays on one line above 600 px. Each step's heading says the rest. */
export const ADD_STEPS = ["What", "Folder", "Check", "When"] as const;

/** Saving on change (Features.autoSave "change"), in the same words in the Add flow and in Settings. */
export const AUTO_SAVE_LABEL = "Save when files change, while Time Machine is open";
export const AUTO_SAVE_NOTE = "It waits for 20 seconds without changes and saves at most once a minute. Nothing is saved while the app is closed.";

const choice = (v: AutoSave, on: boolean, title: string, note: string): string =>
  `<label class="opt ${on ? "on" : ""}"><input type="radio" name="autosave" data-act="ob-autosave" data-v="${v}"${on ? " checked" : ""}><span><div class="t">${esc(title)}</div><div class="d">${esc(note)}</div></span><span></span></label>`;

/** Step 4 for a plain folder: save on change, or only on Save now. No Claude Code lines: the engine adds none to a folder. */
export function folderWhenChoices(autoSave: AutoSave, saveKey: string): string {
  return choice("change", autoSave === "change", AUTO_SAVE_LABEL, AUTO_SAVE_NOTE)
    + choice("off", autoSave === "off", "Only when I press Save now", `${saveKey} in the app, or Save now from More actions.`);
}

/** Step 4 for a Git project: the same switch as one row under the Claude Code row. Its input sets the other value. */
export function autoSaveRow(autoSave: AutoSave): string {
  const on = autoSave === "change";
  return `<label class="opt ${on ? "on" : ""}"><input type="checkbox" data-act="ob-autosave" data-v="${on ? "off" : "change"}"${on ? " checked" : ""}><span><div class="t">${esc(AUTO_SAVE_LABEL)}</div><div class="d">${esc(AUTO_SAVE_NOTE)}</div></span><span></span></label>`;
}

/** Step 1: four cards. Picking one goes straight on to the folder. `busy` (or a full free plan) disables them. */
export function purposeCards(selected: Purpose | null, busy: boolean): string {
  const cards = ADD_PURPOSES.map((p) => {
    const w = PURPOSES[p];
    return `<li><button class="ad-card${selected === p ? " on" : ""}" data-act="ob-purpose" data-v="${p}" aria-pressed="${selected === p}" ${busy ? "disabled" : ""}>${purposeIcon(p)}<span class="ad-t"><b>${esc(w.label)}</b><span>${esc(w.hint)}</span></span></button></li>`;
  }).join("");
  return `<div><h1 id="ad-h" tabindex="-1">What do you want to protect?</h1><p class="lede">Pick what is in the folder. It only changes the words and the setup. Everything stays on this computer.</p></div>
    <ul class="ad-cards" aria-labelledby="ad-h">${cards}</ul>`;
}

/** What the Protect buttons and step 1 say when the free plan lists as many projects as it can. */
export const ADD_FULL = "Free plan full: remove one in Storage";

/** Step 1 on a full free plan: said before anything is picked, with the way to Storage (where Remove is) and to a key. */
export function addFullCard(limit: number): string {
  return `<div class="note warn ad-full" role="status" id="ad-full"><p><b>${esc(ADD_FULL)}.</b> ${esc(`The free plan lists up to ${plural(limit, "project")}. A license, $50 once, lifts that limit. Every restore stays free.`)}</p>
    <div class="row-btns"><button class="btn" data-act="storage">Open Storage</button><button class="btn link" data-act="plan">Paste a key</button></div></div>`;
}

/** What the folder field is missing before anything is asked of the engine; null when the engine can judge it. ~ is fine: the engine expands it. */
export function pathProblem(path: string): string | null {
  const t = path.trim();
  if (!t) return "Enter a folder path.";
  if (t === "~" || t.startsWith("~/") || t.startsWith("/") || /^[A-Za-z]:\\/.test(t)) return null;
  return "Enter the whole path to the folder, starting with / or ~/.";
}

/** Build it is a choice only when package.json has a build script and it is not already the detected check. */
export function buildOffered(purpose: Purpose, scripts: readonly string[], detected: string): boolean {
  return purpose === "code" && scripts.includes("build") && detected !== "npm run build";
}

/** "Found 7 save points from before." for a folder added again, or set up with tm init; null when it is new. */
export function foundBefore(n: number, purpose: Purpose): string | null {
  if (n <= 0) return null;
  const w = PURPOSES[purpose];
  return `Found ${plural(n, w.unit, w.units)} from before.`;
}

/** Saving on change starts on for a plain folder of documents, research or agent work, as the engine sets it when adding. */
export function defaultAutoSave(kind: ProjectKind, purpose: Purpose): AutoSave {
  return kind === "folder" && purpose !== "code" && purpose !== "other" ? "change" : "off";
}

/** Step 2's lede: a Git project or a plain folder both work. */
export function pathLede(purpose: Purpose): string {
  return purpose === "code"
    ? "A Git project or a plain folder on this computer. Your files stay here. This is not an upload."
    : "Any folder on this computer. Git is not needed. Your files stay here. This is not an upload.";
}

/** What adding writes, said before anything is added. Only code projects hear about Git. */
export function pathSetupNote(purpose: Purpose): string {
  return purpose === "code"
    ? "Nothing is added until the last step. Then a Git project gets one small settings file, timemachine.yml, and a plain folder gets nothing new. Save points are always kept outside your folder."
    : "Nothing is added until the last step, and your folder gets nothing new. Its history is kept in the Time Machine store, outside the folder.";
}

/** The check step: its words, and the "no check" choice. */
export interface CheckStepCopy {
  heading: string;
  lede: string;
  /** The "no check" choice. A code project is told what it gives up (no Works or Broken); the others only save versions. */
  skip: { title: string; note: string };
}

export function checkStepCopy(purpose: Purpose, name: string): CheckStepCopy {
  if (checkRecommended(purpose)) {
    return {
      heading: `How should we check that ${name} works?`,
      lede: "A check is a command. If it finishes without an error, the version works.",
      skip: { title: "No tests yet: only save versions", note: "From now on, save points are saved without a check, so they are not called Works or Broken. You compare versions and put files back by hand. Add a check later in Settings." },
    };
  }
  const what = purpose === "research" ? "a run" : "a version";
  return {
    heading: `Check ${name}, or only save versions?`,
    lede: `A check is optional here. It is a command, like a script that tests ${what}. Without one, Time Machine saves versions you can bring back as a copy.`,
    skip: { title: "Skip the check and save versions", note: "You can still compare versions and bring any of them back as a copy." },
  };
}

/** The "no check" choice's note. When the project's own timemachine.yml already had a check, it says this empties it and
 *  Back puts it back (Security B6); a Git project also hears that Git will show that edit as a change. */
export function skipNote(note: string, emptiesCheck: boolean, kind: ProjectKind): string {
  if (!emptiesCheck) return note;
  return `${note} This empties the check in your timemachine.yml${kind === "git" ? " (a change Git will show)" : ""}; Back puts it back.`;
}

/** The choice the check step starts on: the detected command if there is one, else typing one for code, else no check. */
export function firstCheckChoice(purpose: Purpose, detected: string): "detected" | "custom" | "none" {
  if (detected.trim()) return "detected";
  return checkRecommended(purpose) ? "custom" : "none";
}

/** The toast when setup ends without a check: nothing claims the folder works. */
export function savedOnlyToast(name: string): string {
  return `You’re set. Versions of ${name} are saved on this computer.`;
}
