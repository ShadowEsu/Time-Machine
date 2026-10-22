// "Jump to…" (⌘K): projects, recent save points and actions in one list you can type into.
// Items are plain data with the same data-act attributes as the buttons they stand for.
import type { Verdict } from "../shared/api.js";

export interface PaletteItem {
  group: "Actions" | "Projects" | "Save points";
  label: string;
  /** Quiet text on the right: a shortcut, a verdict word, a time. Also searched. */
  hint: string;
  act: string;
  id?: string;
  a?: string;
  b?: string;
  /** A verdict glyph for projects and save points. `undefined` for actions. */
  verdict?: Verdict | null;
}

/** Every typed word must appear in the label or the hint. An empty query keeps everything, in order. */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const text = `${it.label} ${it.hint}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
