// The survey's inline card and its sheet (shared/pmf.ts). Pure markup builders, tested without a window. The answers live in
// the window's memory only, until Send.
import { esc } from "../shared/format.js";
import { PMF_Q1, PMF_Q1_OPTIONS, PMF_Q2, PMF_Q3, PMF_Q4, PMF_SENDS, PMF_TEXT_MAX, type PmfFeeling } from "../shared/pmf.js";

export interface PmfDraft {
  q1: PmfFeeling | null;
  q2: string;
  q3: string;
  q4: string;
}

export interface PmfView {
  /** The card was drawn in this app session, so it stays until No thanks or Send. */
  session: boolean;
  open: boolean;
  draft: PmfDraft;
  sending: boolean;
  error: string | null;
  /** Send worked: the sheet thanks, and neither it nor the card comes back. */
  sent: boolean;
}

export const PICK_Q1 = "Choose an answer to question 1 first. The other three are optional.";

export function emptyPmf(): PmfView {
  return { session: false, open: false, draft: { q1: null, q2: "", q3: "", q4: "" }, sending: false, error: null, sent: false };
}

/** Inline in the page, never over it. No thanks closes it for good. */
export function pmfCardHtml(): string {
  return `<section class="note tip pmf-card" aria-labelledby="pmf-card-h"><p><b id="pmf-card-h">Four questions about Time Machine.</b> Your answers help us decide what to build. They stay on this computer unless you press Send.</p>
    <div class="row-btns"><button class="btn dark" data-act="pmf-open">Answer 4 questions</button><button class="btn ghost" data-act="pmf-no">No thanks</button></div></section>`;
}

/** The survey ID and how to have the answers deleted. Shown after Send and in Settings, so it can be quoted. */
export function pmfIdHtml(surveyId: string): string {
  return `Your survey ID is <code class="mono sel-text pmf-id">${esc(surveyId)}</code>. To have your answers deleted, email this ID to the address in our <button type="button" class="btn link" data-act="pmf-privacy">Privacy Policy (draft)</button>`;
}

/**
 * The sheet with the four questions, the consent line next to Send, or the thank-you after Send. `enter` is the scrim's
 * entrance class; `surveyId` is the random ID that went with the answers, once sent.
 */
export function pmfSheetHtml(v: PmfView, enter: string, surveyId: string | undefined): string {
  if (!v.open) return "";
  const head = (title: string, close: string): string =>
    `<div class="sheet-head"><h2 id="pmf-title">${esc(title)}</h2><button class="btn quiet" data-act="pmf-close"${v.sending ? " disabled" : ""}>${close}<kbd>Esc</kbd></button></div>`;
  if (v.sent) {
    return `<div class="scrim ${enter}" data-leave="pmf"><div class="sheet pmf" role="dialog" aria-modal="true" aria-labelledby="pmf-title">
      ${head("Thank you", "Close")}<p role="status">Your answers were sent. This survey won’t show again.</p>${surveyId ? `<p class="pmf-consent">${pmfIdHtml(surveyId)}</p>` : ""}</div></div>`;
  }
  const busy = v.sending ? " disabled" : "";
  const radios = PMF_Q1_OPTIONS.map(([value, label]) =>
    `<label class="opt${v.draft.q1 === value ? " on" : ""}"><input type="radio" name="pmf-q1" id="pmf-q1-${value}" data-act="pmf-q1" data-v="${value}"${v.draft.q1 === value ? " checked" : ""}${busy}><span><div class="t">${esc(label)}</div></span><span></span></label>`).join("");
  const text = (n: 2 | 3 | 4, q: string): string =>
    `<label class="pmf-q" for="pmf-q${n}"><span class="pmf-l">${n}. ${esc(q)} <span class="muted">Optional</span></span><textarea id="pmf-q${n}" class="field" data-model="pmf-q${n}" rows="3" maxlength="${PMF_TEXT_MAX}"${busy}>${esc(v.draft[`q${n}`])}</textarea></label>`;
  return `<div class="scrim ${enter}" data-leave="pmf"><div class="sheet pmf" role="dialog" aria-modal="true" aria-labelledby="pmf-title">
    ${head("Four questions", "Close")}
    <form class="pmf-form" data-form="pmf" novalidate>
      <fieldset class="pmf-q"><legend class="pmf-l">1. ${esc(PMF_Q1)}</legend><div class="pmf-opts">${radios}</div></fieldset>
      ${text(2, PMF_Q2)}${text(3, PMF_Q3)}${text(4, PMF_Q4)}
      <p class="pmf-consent small" id="pmf-consent">${esc(PMF_SENDS)} <button type="button" class="btn link" data-act="pmf-privacy">Privacy Policy (draft)</button></p>
      ${v.error ? `<div class="note bad" role="alert">${esc(v.error)}</div>` : ""}
      <div class="row-btns"><button type="button" class="btn quiet" data-act="pmf-close"${busy}>Cancel</button><button type="submit" class="btn dark" aria-describedby="pmf-consent"${busy}>${v.sending ? "Sending…" : "Send"}</button></div>
    </form></div></div>`;
}
