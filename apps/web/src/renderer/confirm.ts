// The confirm before something that removes or goes back without proof. "Never mind" comes first, so it
// is the control that gets focus when the sheet opens, and pressing Enter right away changes nothing.
// Bringing a version back has one confirm of its own, whatever opened it (B3): the version, what comes back and what
// does not (full size, no card around them), and two buttons named for the outcome.
import { esc, keepTimes } from "../shared/format.js";

export interface ConfirmCopy {
  title: string;
  body: string;
  /** The button that does it: the same words as the button that opened the confirm. */
  action: string;
}

/** The two buttons: Never mind, then the action. The order is the focus order. */
export function confirmButtons(action: string): string {
  return `<button class="btn" data-act="confirm-cancel">Never mind</button><button class="btn dark" data-act="confirm-do">${esc(action)}</button>`;
}

/** The bring back confirm's place among the open dialogs (its data-leave), so focus goes back to what opened it. */
export const BRING_KEY = "bring";

export interface BringBackView {
  /** The version inside a sentence: "“Added dark mode” (8:03:18 AM)", or "the save at 2:58:48 AM". */
  name: string;
  /** A plain folder has no Git, so no branch is made: its confirm never mentions one (Design gate MF2). The branch's name is
   *  only known once it is made (the engine picks the next free one), so Done names it, not this. */
  folder: boolean;
  /** What comes back and what does not, from the save point's coverage, which the engine reports. */
  comes: string[];
  notComes: string[];
  /** One line when the version is not proven to work (unprovenLine), else null. */
  unproven: string | null;
  /** A phone's bottom sheet: the buttons stack full width, Bring it back on top and Never mind last. */
  phone: boolean;
  /** The bring back is running: both buttons wait. */
  working: boolean;
  /** Why the last try failed. The confirm stays, so it can be tried again or left. */
  error: string | null;
}

/** The one confirm for a bring back. `enter` is the scrim's entrance class, when it has just opened. */
export function bringBackConfirm(v: BringBackView, enter: string): string {
  const list = (id: string, cls: string, h: string, items: string[]): string =>
    `<section class="bb-list${cls}" aria-labelledby="${id}"><h3 id="${id}">${h}</h3><ul>${(items.length ? items : ["Nothing listed"]).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>`;
  const lede = v.folder
    ? "We make a copy of it next to your folder. Your folder is not touched, and every save point stays."
    : "We make a copy of it next to your folder, on a new branch. Your folder is not touched, and every save point stays.";
  const off = v.working ? " disabled" : "";
  // Never mind takes focus when it opens, so Enter right away changes nothing; Tab reaches Bring it back.
  const never = `<button class="btn" data-act="tv-exit" data-key="esc" data-autofocus${off}>Never mind</button>`;
  const bring = `<button class="btn dark" data-act="tv-use" data-key="enter"${off}>${v.working ? "Bringing it back…" : "Bring it back"}</button>`;
  return `<div class="scrim bb-scrim${enter ? ` ${enter}` : ""}" data-leave="${BRING_KEY}"><div class="sheet bb${v.phone ? " phone" : ""}" role="dialog" aria-modal="true" aria-labelledby="bb-h" aria-describedby="bb-lede">
    <h2 id="bb-h">Bring back <span class="bb-name">${keepTimes(esc(`${v.name}?`))}</span></h2>
    <p class="bb-lede" id="bb-lede">${lede}</p>
    ${v.unproven ? `<p class="bb-unproven">${esc(v.unproven)}</p>` : ""}
    ${v.error ? `<div class="note bad" role="alert">${esc(v.error)}</div>` : ""}
    <div class="bb-lists">${list("bb-yes", "", "What comes back", v.comes)}${list("bb-no", " no", "What does not come back", v.notComes)}</div>
    <div class="bb-btns">${v.phone ? bring + never : never + bring}</div>
  </div></div>`;
}
