// The Add flow: what to protect, then the folder, then a check (required for code, optional for the rest), then
// when to save. The words and choices are decided here, from the purpose alone, so the window and the tests agree.
import type { AutoSave, Purpose } from "../shared/api.js";
import { esc } from "../shared/format.js";
import { ADD_PURPOSES, checkRequired, PURPOSES, purposeIcon } from "./purpose.js";

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

/** Step 1: four cards. Picking one goes straight on to the folder. Research says plainly what it is: backups of your own files. */
export function purposeCards(selected: Purpose | null, busy: boolean): string {
  const cards = ADD_PURPOSES.map((p) => {
    const w = PURPOSES[p];
    const extra = p === "research" ? '<span class="ad-own">Backups of your own files on this computer.</span>' : "";
    return `<li><button class="ad-card${selected === p ? " on" : ""}" data-act="ob-purpose" data-v="${p}" aria-pressed="${selected === p}" ${busy ? "disabled" : ""}>${purposeIcon(p)}<span class="ad-t"><b>${esc(w.label)}</b><span>${esc(w.hint)}</span>${extra}</span></button></li>`;
  }).join("");
  return `<div><h1 id="ad-h" tabindex="-1">What do you want to protect?</h1><p class="lede">Pick what is in the folder. It only changes the words and the setup. Everything stays on this computer.</p></div>
    <ul class="ad-cards" aria-labelledby="ad-h">${cards}</ul>`;
}

/** Step 2's lede: a Git project or a plain folder both work. */
export function pathLede(purpose: Purpose): string {
  return purpose === "code"
    ? "A Git project or a plain folder on this computer. Your files stay here. This is not an upload."
    : "Any folder on this computer. Git is not needed. Your files stay here. This is not an upload.";
}

/** What adding writes, said before anything is added. */
export const PATH_SETUP_NOTE = "Setup starts when you add it, and we make your first save point. A Git project gets one small settings file, timemachine.yml. A plain folder gets nothing new: its settings and history live in the Time Machine store. Save points are always kept outside your folder.";

/** The check step: whether it can be skipped, and its words. */
export interface CheckStepCopy {
  heading: string;
  lede: string;
  /** The "no check" choice, or null when a check is required. */
  skip: { title: string; note: string } | null;
}

export function checkStepCopy(purpose: Purpose, name: string): CheckStepCopy {
  if (checkRequired(purpose)) {
    return { heading: `How should we check that ${name} works?`, lede: "A check is a command. If it finishes without an error, the version works.", skip: null };
  }
  const what = purpose === "research" ? "a run" : "a version";
  return {
    heading: `Check ${name}, or only save versions?`,
    lede: `A check is optional here. It is a command, like a script that tests ${what}. Without one, Time Machine saves versions you can bring back as a copy.`,
    skip: { title: "Skip the check and save versions", note: "You can still compare versions and bring any of them back as a copy." },
  };
}

/** The choice the check step starts on: the detected command if there is one, else typing one for code, else no check. */
export function firstCheckChoice(purpose: Purpose, detected: string): "detected" | "custom" | "none" {
  if (detected.trim()) return "detected";
  return checkRequired(purpose) ? "custom" : "none";
}

/** The toast when setup ends without a check: nothing claims the folder works. */
export function savedOnlyToast(name: string): string {
  return `You’re set. Versions of ${name} are saved on this computer.`;
}
