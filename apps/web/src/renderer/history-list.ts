// History as a list (L364 redesign B): the pure parts, so the app and its tests agree on what is selected first, what
// the status line says, what each row and each ruler mark shows, and where the arrow keys go.
import type { Verdict } from "../shared/api.js";
import { sentenceStart, verdictKey, verdictWord } from "../shared/format.js";

export interface ListPoint {
  id: string;
  verdict: Verdict | null;
}

/**
 * The row History selects when nothing else is chosen: the last version that works while the newest does not, so the
 * answer and its action show without a click. Otherwise the newest. `pts` are oldest first.
 */
export function defaultPick(pts: readonly ListPoint[], lastWorkingId: string | null): string | null {
  const newest = pts.at(-1);
  if (!newest) return null;
  if (lastWorkingId && newest.verdict !== "PASS" && pts.some((p) => p.id === lastWorkingId)) return lastWorkingId;
  return newest.id;
}

/** The save point it broke at: the first Broken one after the last that works. Null when none is recorded. `pts` are oldest first. */
export function brokeAt<T extends ListPoint>(pts: readonly T[], lastWorkingId: string | null): T | null {
  const i = pts.findIndex((p) => p.id === lastWorkingId);
  if (i < 0) return null;
  return pts.slice(i + 1).find((p) => p.verdict === "FAIL") ?? null;
}

/**
 * The one status line above the list. With a version that works behind a broken newest: "Broken since “A”. “B” still
 * works." Otherwise the status rule's own head and time, said as one line. `broke` and `works` are names as said in a
 * sentence (a message in quotes, or "the save at 2:58:48 AM").
 */
export function statusLine(o: { newest: Verdict | null; broke: string | null; works: string | null; head: string; voice: string }): string {
  if (o.newest === "FAIL" && o.works) return `${o.broke ? `Broken since ${o.broke}.` : "Broken."} ${sentenceStart(o.works)} still works.`;
  return [o.head, o.voice].filter(Boolean).join(" ");
}

/** Where a key moves the selection in a list shown newest first: Down is older, Up is newer, Home the newest, End the oldest. Null for any other key. */
export function listMove(count: number, at: number, key: string): number | null {
  if (!count) return null;
  const last = count - 1;
  const from = Math.min(Math.max(at, 0), last);
  switch (key) {
    case "ArrowDown":
      return Math.min(last, from + 1);
    case "ArrowUp":
      return Math.max(0, from - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return Math.min(last, from + 10);
    case "PageUp":
      return Math.max(0, from - 10);
    default:
      return null;
  }
}

/**
 * The files that changed after a save point, up to now: every path the later save points changed, newest first, each once.
 * `known` is false while a later save point's changes are not read yet. `pts` are oldest first.
 */
export function changedSince(pts: readonly ListPoint[], id: string, changes: ReadonlyMap<string, readonly string[]>): { paths: string[]; known: boolean } {
  const i = pts.findIndex((p) => p.id === id);
  if (i < 0) return { paths: [], known: false };
  const seen = new Set<string>();
  let known = true;
  for (let k = pts.length - 1; k > i; k--) {
    const c = changes.get(pts[k]!.id);
    if (!c) {
      known = false;
      continue;
    }
    for (const f of c) seen.add(f);
  }
  return { paths: [...seen], known };
}

/** From this window width the preview sheet sits beside History's list; narrower, it is a page of its own over History. */
export const SHEET_SIDE_MIN = 1100;

/**
 * How the preview sheet is laid out at a window width. Beside the list (`side`) it is not modal: the list stays usable, so
 * the arrows keep previewing. Narrower it is a full-height page over History (`page`): modal, with a Back control at its
 * top and its one primary in a bar at its foot.
 */
export function sheetLayout(width: number): { mode: "side" | "page"; modal: boolean; back: boolean; bar: boolean } {
  return width >= SHEET_SIDE_MIN ? { mode: "side", modal: false, back: false, bar: false } : { mode: "page", modal: true, back: true, bar: true };
}

/** What a key does to the preview sheet: open or closed after it, how far the selection moves, and where focus goes (null: it stays). */
export interface SheetMove {
  open: boolean;
  move: -1 | 0 | 1;
  focus: "list" | "sheet" | "name" | null;
}

/**
 * The preview sheet's keys. `at` is where focus is: History's list (the row), inside the sheet, or elsewhere; `typing` is
 * a field with the caret. Esc closes an open sheet from anywhere and focus goes back to the row. Enter on the row opens
 * it: beside the list focus stays on the row, as a page focus goes into it. F2 renames: the sheet opens with its name
 * field in focus. ↑ and ↓ inside a sheet beside the list move the selection and the sheet follows. Null: not the sheet's key.
 */
export function sheetKey(key: string, s: { mode: "side" | "page"; at: "list" | "sheet" | "other"; open: boolean; typing: boolean }): SheetMove | null {
  if (key === "Escape") return s.open ? { open: false, move: 0, focus: "list" } : null;
  if (s.typing) return null;
  if (key === "F2" && (s.at === "list" || (s.open && s.at === "sheet"))) return { open: true, move: 0, focus: "name" };
  if (key === "Enter" && s.at === "list") return { open: true, move: 0, focus: s.mode === "side" ? "list" : "sheet" };
  if ((key === "ArrowDown" || key === "ArrowUp") && s.open && s.mode === "side" && s.at === "sheet") return { open: true, move: key === "ArrowDown" ? 1 : -1, focus: null };
  return null;
}

/**
 * Whether the toolbar offers Back to now. Compare is a look at the past; History's preview sheet is not: Esc or Close
 * closes it, and its Bring back stays the one dark action on screen.
 */
export function showsBackToNow(screen: string): boolean {
  return screen === "compare";
}

/**
 * What a row says about its save point: a word, an icon and a colour (`key`), never the colour alone. `icon` is "verdict"
 * for the verdict's own shape (a check, a cross, a ring), "glyph" for the small mark of a state in progress or a damaged
 * save point, and "none" for a project with no check, whose rows only say Saved.
 */
export function rowVerdict(v: Verdict | null, o: { checks: boolean; checking?: boolean; damaged?: boolean }): { key: string; word: string; icon: "verdict" | "glyph" | "none" } {
  if (o.damaged) return { key: "damaged", word: "Damaged", icon: "glyph" };
  if (o.checking) return { key: "checking", word: "Checking", icon: "glyph" };
  if (v === null && !o.checks) return { key: "none", word: "Saved", icon: "none" };
  return { key: verdictKey(v), word: verdictWord(v), icon: "verdict" };
}

/** The mini-ruler shows at most this many save points, the newest. */
export const RULER_MARKS = 60;

/**
 * The mini-ruler over the list: one mark per save point, oldest on the left, in Overview's shapes (a filled circle for
 * Works, a diamond for Broken, a hollow ring for Not checked yet). Works and Broken carry their glyph, so the shape and
 * the glyph read without the colour. `on` is the selected save point, `lw` the last version that works while the newest
 * does not. `pts` are oldest first; the marks come newest first, the order the strip lays them out from the right.
 */
export function rulerMarks(pts: readonly ListPoint[], selected: string | null, lw: string | null): { id: string; v: Verdict | null; key: string; glyph: boolean; on: boolean; lw: boolean }[] {
  return pts.slice(-RULER_MARKS).reverse().map((p) => ({ id: p.id, v: p.verdict, key: verdictKey(p.verdict), glyph: p.verdict === "PASS" || p.verdict === "FAIL", on: p.id === selected, lw: p.id === lw }));
}

/** The shortest run of quiet save points that folds into one row. */
export const FOLD_MIN = 4;

/** One item of History's list: a save point's row, or a fold of quiet ones keyed by its first (newest) id. */
export type ListItem<T> = { row: T } | { fold: string; rows: T[] };

/**
 * Folds every run of `FOLD_MIN` or more save points next to each other that `quiet` says may fold (in the app:
 * unnamed, unpinned, never checked, not selected) into one item, so a long session of automatic saves does not push the
 * last version that works out of sight. A row that may not fold ends a run. `open` holds the save points of folds that
 * were opened: a run with any of them stays as rows, so selecting a row of an opened fold never folds the rest again.
 */
export function foldRuns<T extends { id: string }>(rows: readonly T[], quiet: (c: T) => boolean, open: ReadonlySet<string>): ListItem<T>[] {
  const out: ListItem<T>[] = [];
  let run: T[] = [];
  const flush = (): void => {
    const key = run[0]?.id;
    if (key && run.length >= FOLD_MIN && !run.some((c) => open.has(c.id))) out.push({ fold: key, rows: run });
    else for (const c of run) out.push({ row: c });
    run = [];
  };
  for (const c of rows) {
    if (quiet(c)) run.push(c);
    else {
      flush();
      out.push({ row: c });
    }
  }
  flush();
  return out;
}
