// "Jump to…" (⌘K): projects, recent save points and actions in one list you can type into.
// Items are plain data with the same data-act attributes as the buttons they stand for.
import type { RunNote, Verdict } from "../shared/api.js";
import { shownTitle } from "./runs.js";

export interface PaletteItem {
  group: "Actions" | "Projects" | "Save points";
  label: string;
  /** A save point's title, after its time in `label`: on the same line, or on a line of its own on a phone. Also searched. */
  title?: string;
  /** Quiet text on the right: a shortcut, a verdict word, a time. Also searched. */
  hint: string;
  /** The hint is a shortcut: it is drawn as a keycap on the right of the row. */
  keycap?: true;
  act: string;
  id?: string;
  a?: string;
  b?: string;
  /** A verdict glyph for projects and save points. `undefined` for actions. */
  verdict?: Verdict | null;
}

/** Every typed word must appear in the label, the title or the hint. An empty query keeps everything, in order. */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const text = `${it.label} ${it.title ?? ""} ${it.hint}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** The Reduce motion switch of Settings > Appearance, one item away in Jump to. Its hint says whether it is on now. */
export function reduceMotionItem(on: boolean): PaletteItem {
  return { group: "Actions", label: "Reduce motion", hint: on ? "On" : "Off", act: "reduce-motion" };
}

/** A save point in Jump to: its time, then the name it was given in its detail (else the one History made), then its verdict
 *  word, after "Pinned" when it is pinned. The given name is searched like any title. */
export function savePointItem(c: { id: string; verdict: Verdict | null }, time: string, made: string, note: RunNote | undefined, hint: string): PaletteItem {
  return { group: "Save points", label: time, title: shownTitle(made, note), hint: note?.pinned ? (hint ? `Pinned · ${hint}` : "Pinned") : hint, act: "open", id: c.id, verdict: c.verdict };
}
