// Runs: a name, a note and a pin on a save point, for research and trial runs (and anything else worth finding again).
// Notes live in a sidecar file in the store, never inside the save point, and no live event follows a change, so the
// app reads them again after each save. Research projects call save points "runs" in their labels.
import type { Purpose, RunNote } from "../shared/api.js";
import { esc } from "../shared/format.js";
import { PURPOSES } from "./purpose.js";

export type JournalFilter = "all" | "works" | "named" | "pinned";

/** The longest name and note the store keeps (api.ts RunNoteSchema). */
export const TITLE_MAX = 80;
export const NOTE_MAX = 2000;

/** What one save point is called here, in a label's three forms: "run", "runs", "Run". */
export function unitWords(purpose: Purpose): { one: string; many: string; One: string } {
  const w = PURPOSES[purpose];
  return { one: w.unit, many: w.units, One: w.unit.charAt(0).toUpperCase() + w.unit.slice(1) };
}

/** The title a row shows: the person's own name for it when there is one, else the one History made. */
export function shownTitle(made: string, note: RunNote | undefined): string {
  return note?.title?.trim() || made;
}

/** What changed, in a few words: "price.js", "chapter-1.md and 2 more". Empty when nothing is known yet. */
export function changedLine(files: readonly string[] | undefined): string {
  const first = files?.[0];
  if (!first) return "";
  const name = first.split("/").filter(Boolean).at(-1) ?? first;
  return files.length > 1 ? `${name} and ${files.length - 1} more` : name;
}

/**
 * A save point's title, never empty. A save made with no note (Save now in a folder, say) is named by what changed,
 * "chapter-1.md and 2 more", or, before its changes are read, by how it was made.
 */
export function rowTitle(made: string, trigger: string, files: readonly string[] | undefined): string {
  if (made.trim()) return made;
  const changed = changedLine(files);
  if (changed) return changed;
  if (trigger === "auto") return "Auto save";
  if (trigger.startsWith("claude-code")) return "Saved by Claude Code";
  return "Saved by you";
}

/** The save points History shows under a filter: all, the ones whose check passed, the ones someone named, or the pinned ones. */
export function filtered<T extends { id: string; verdict: string | null }>(points: readonly T[], notes: ReadonlyMap<string, RunNote>, filter: JournalFilter): T[] {
  if (filter === "works") return points.filter((c) => c.verdict === "PASS");
  if (filter === "named") return points.filter((c) => !!notes.get(c.id)?.title?.trim());
  if (filter === "pinned") return points.filter((c) => notes.get(c.id)?.pinned);
  return [...points];
}

/** How many save points each filter shows. `works` is null for a project with no check, which has no Works filter. */
export function filterCounts<T extends { id: string; verdict: string | null }>(points: readonly T[], notes: ReadonlyMap<string, RunNote>, checks: boolean): { works: number | null; named: number; pinned: number } {
  return { works: checks ? filtered(points, notes, "works").length : null, named: filtered(points, notes, "named").length, pinned: filtered(points, notes, "pinned").length };
}

/** A small pin, filled when pinned. Decorative: the words beside it say so. */
export function pinIcon(on: boolean): string {
  return `<svg class="pin-i" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 2.5h4l-.6 4 2.6 2.4H4l2.6-2.4zM8 8.9v4.6" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/** All / Works / Named / Pinned over History's list, each filter with how many it shows. */
export function filterBar(filter: JournalFilter, counts: { works: number | null; named: number; pinned: number }, purpose: Purpose): string {
  const u = unitWords(purpose);
  const b = (v: JournalFilter, label: string): string => `<button class="${filter === v ? "on" : ""}" aria-pressed="${filter === v}" data-act="journal-filter" data-v="${v}">${label}</button>`;
  const n = (k: number): string => `<span class="jf-n">${k}</span>`;
  return `<div class="jf" role="group" aria-label="${esc(`Show ${u.many}`)}">${b("all", "All")}${counts.works === null ? "" : b("works", `Works${n(counts.works)}`)}${b("named", `Named${n(counts.named)}`)}${b("pinned", `${pinIcon(true)}Pinned${n(counts.pinned)}`)}</div>`;
}

/** A filter that shows nothing: what it is waiting for, and the way back to all of them. */
export function noneShown(filter: Exclude<JournalFilter, "all">, purpose: Purpose): string {
  const u = unitWords(purpose);
  const words = { works: [`No ${u.many} have passed their check yet.`, ""], named: [`No named ${u.many} yet.`, `Open a ${u.one} and give it a name.`], pinned: [`No pinned ${u.many} yet.`, `Open a ${u.one} and choose Pin to keep it at hand.`] }[filter];
  return `<div class="jf-empty"><p><b>${esc(words[0] ?? "")}</b>${words[1] ? ` ${esc(words[1])}` : ""}</p><button class="btn quiet" data-act="journal-filter" data-v="all">Show all</button></div>`;
}

/** The draft being typed in a detail. Kept in state, so a redraw never loses it. */
export interface NoteDraft {
  id: string;
  title: string;
  note: string;
}

/** "26/80": how much of the name's room is used, as the store trims it. */
export function nameCount(title: string): string {
  return `${title.trim().length}/${TITLE_MAX}`;
}

/** What Save says it saves, and the toast after: the name, the note, or both, by what changed. Nothing changed says name. */
export function noteSaveWords(draft: NoteDraft, note: RunNote | undefined): { button: string; toast: string } {
  const name = draft.title.trim() !== (note?.title ?? "");
  const text = draft.note !== (note?.note ?? "");
  if (name && text) return { button: "Save name and note", toast: "Name and note saved on this computer." };
  if (text) return { button: "Save note", toast: "Note saved on this computer." };
  return { button: "Save name", toast: "Name saved on this computer." };
}

/** The detail's name, note and pin. `saving` disables the form while setNote runs. */
export function noteBlock(id: string, note: RunNote | undefined, draft: NoteDraft, purpose: Purpose, saving: boolean): string {
  const u = unitWords(purpose);
  const pinned = !!note?.pinned;
  const busy = saving ? "disabled" : "";
  const changed = draft.title.trim() !== (note?.title ?? "") || draft.note !== (note?.note ?? "");
  const example = purpose === "research" ? "for example: Baseline run, seed 42" : purpose === "code" ? "for example: Before the big refactor" : "for example: Draft before advisor notes";
  return `<section class="rn" aria-labelledby="rn-h">
    <div class="rn-top"><h3 id="rn-h">${esc(`Name this ${u.one}`)}</h3><button type="button" class="rn-pin${pinned ? " on" : ""}" data-act="pin" data-id="${esc(id)}" aria-pressed="${pinned}" ${busy}>${pinIcon(pinned)}${pinned ? "Pinned" : "Pin"}</button></div>
    <form class="rn-form" data-form="note" data-id="${esc(id)}" novalidate>
      <div class="rn-l"><label for="rn-title">Name</label><span class="rn-count" id="rn-count">${nameCount(draft.title)}</span></div>
      <input id="rn-title" class="field" data-model="note-title" type="text" maxlength="${TITLE_MAX}" value="${esc(draft.title)}" placeholder="${esc(example)}" autocomplete="off" aria-describedby="rn-count" ${busy}>
      <label for="rn-note">Note</label>
      <textarea id="rn-note" class="field" data-model="note-text" rows="3" maxlength="${NOTE_MAX}" placeholder="What you tried, what you saw" ${busy}>${esc(draft.note)}</textarea>
      <div class="rn-acts"><button type="submit" class="btn" ${busy}>${saving ? "Saving…" : noteSaveWords(draft, note).button}</button>${note?.updated && !changed ? '<span class="rn-saved">Saved on this computer, next to its history</span>' : ""}</div>
    </form>
  </section>`;
}
