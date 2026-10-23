// The confirm before something that removes or goes back without proof. "Never mind" comes first, so it
// is the control that gets focus when the sheet opens, and pressing Enter right away changes nothing.
import { esc } from "../shared/format.js";

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
