// Entrance timing that survives redraws. The window redraws from state, often several times while
// something is still entering, so an entrance carries on where it was instead of starting over.

/** A new page fades in and rises 8 px over this long. */
export const PAGE_IN_MS = 220;
/** Sheets, the Rewind, the Inspector and toasts fade out over this long (exits stay at or under 150 ms). */
export const LEAVE_MS = 150;
/** The Rewind's playhead glides along its ruler over this long (--t-travel). */
export const GLIDE_MS = 420;
/** A tick the gliding playhead crosses flicks once, over this long. */
export const FLICK_MS = 180;
/** A Works save point the playhead lands on rings once, over this long, as the glide ends. */
export const RING_MS = 520;

/**
 * The animation delay that shows an entrance `elapsed` ms after it began, for an entrance that
 * starts `start` ms in and runs `duration` ms. Negative means part of it already played. Null
 * when it has finished, so the element is drawn plainly.
 */
export function entranceDelay(start: number, elapsed: number, duration: number): number | null {
  const delay = start - elapsed;
  return delay + duration > 0 ? delay : null;
}

/** A page's blocks (the status, the list...) rise in this far apart... */
export const BLOCK_STAGGER_MS = 50;
/** ...and only the first this many stagger; the rest come with the last of them. */
export const BLOCK_STAGGER_MAX = 5;
/** A verdict that changed on screen (Checking to Works or Broken) settles from 60 % over this long, on --press-ease (--t-press). */
export const SETTLE_MS = 180;
/** The status line's verdict lands over this long, without overshoot. */
export const HERO_MS = 320;
/** A sheet, column or stamp redrawn this soon after it entered carries its entrance on instead of losing it. */
export const ENTER_KEEP_MS = 340;

/** The animation delay for a page's block `index` (0 = the first), `elapsed` ms after the page appeared. */
export function blockDelay(index: number, elapsed: number, duration: number): number | null {
  return entranceDelay(Math.min(index, BLOCK_STAGGER_MAX) * BLOCK_STAGGER_MS, elapsed, duration);
}

/**
 * The class on <html> while Settings > Appearance > Reduce motion is on. The CSS stills with it what the computer's own
 * `prefers-reduced-motion` stills: either one is the one switch. Not "calm": that is the name of Design's shell direction.
 */
export const REDUCE_MOTION_CLASS = "rm";

// B6 §3, Calm motion. Every duration is a token in styles.css (motion.test.ts reads them both).

/** --ease and --press-ease, for the moves made with the Web Animations API. */
export const EASE = "cubic-bezier(.16, 1, .3, 1)";
export const PRESS_EASE = "cubic-bezier(.3, 1.5, .5, 1)";
/** The one primary's label changes with a crossfade this long (--t-snap). */
export const CROSSFADE_MS = 120;
/** All ▾ and More close over this long (--t-snap). */
export const MENU_OUT_MS = 120;
/** Bringing a version back, the biggest moment (--t-moment). */
export const MOMENT_MS = 560;
/** Undo takes the card back into its row over this long (--t-glide). */
export const RETURN_MS = 260;
/** The card lifts this far before it glides. */
export const LIFT_PX = 6;
/** The card's lines arrive this far apart, by opacity only (no typewriter). */
export const LINE_STAGGER_MS = 60;
/** A count rolls its changed digits over this long. */
export const ROLL_MS = 240;
/** History's rows rise one after another on first load only (MOTION-SPEC §2 staggered arrival): --m-stagger apart, the
 *  first this many. */
export const ROW_STAGGER_MS = 70;
export const ROW_STAGGER_MAX = 8;
/** A row rises over this long (.row-in, --m-normal). */
export const ROW_IN_MS = 350;

/** The animation delay for History's row `index` on first load, `elapsed` ms in; null past the eighth row or once played. */
export function rowDelay(index: number, elapsed: number, duration: number): number | null {
  return index < ROW_STAGGER_MAX ? entranceDelay(index * ROW_STAGGER_MS, elapsed, duration) : null;
}

/** MOTION-SPEC §2 count-up: how long a number counts up from 0 to `final` (700 ms under 100, 1000 ms under 10,000, 1200 max). */
export function countUpMs(final: number): number {
  return final < 100 ? 700 : final < 10_000 ? 1000 : 1200;
}

/** --m-ease-smooth, cubic-bezier(.22, 1, .36, 1): the eased progress at time fraction `x` (0 to 1). */
export function easeSmooth(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = [0.22, 1, 0.36, 1];
  const bez = (t: number, a: number, b: number): number => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 24; i++) {
    t = (lo + hi) / 2;
    if (bez(t, x1, x2) < x) lo = t;
    else hi = t;
  }
  return bez(t, y1, y2);
}

/** The number a count-up to `final` shows `elapsed` ms in: whole numbers, never past `final`, `final` once it has run. */
export function countAt(final: number, elapsed: number): number {
  return Math.min(final, Math.round(final * easeSmooth(elapsed / countUpMs(final))));
}

/** The two wins that celebrate (MOTION-SPEC §4, TM app): a check says Works, a version is back in a copy. */
export type CelebrationKind = "works" | "back";
/** A celebration is over within this long: the pop and the burst (MOTION-SPEC §2, ≤ 900 ms). */
export const CELEBRATION_MS = 900;
/** Whether a celebration last played on `last` (a date, or null for never) may play again on `today`: once a day. */
export function celebrationDue(last: string | null, today: string): boolean {
  return last !== today;
}

/** The places in `after` of the digits that differ from `before`: the changed ones, or all of them when the text changed length. */
export function rolledDigits(before: string | null, after: string): number[] {
  if (before === null || before === after) return [];
  const digits = [...after].flatMap((ch, i) => (/\d/.test(ch) ? [i] : []));
  return before.length === after.length ? digits.filter((i) => before[i] !== after[i]) : digits;
}

/** One check result as the engine reported it (the "progress" event). */
export interface RunResult {
  checkpoint: string;
  verdict: string;
}

/** A search as History shows it: each save point's result so far, the one being checked, the first that passed, and "n of up to of". */
export interface CheckRun {
  done: Map<string, string>;
  checking: string | null;
  found: string | null;
  n: number;
  of: number;
}

/**
 * One progress event added to a search's results, for display only (Security C4): the engine sends each result as it lands,
 * and the store watcher replays the same ones later, so a result already there, or one for a save point not in `ids`, adds
 * nothing and the same array comes back.
 */
export function addResult(results: readonly RunResult[], e: RunResult, ids: readonly string[]): RunResult[] {
  if (!ids.includes(e.checkpoint) || results.some((r) => r.checkpoint === e.checkpoint && r.verdict === e.verdict)) return results as RunResult[];
  return [...results, { checkpoint: e.checkpoint, verdict: e.verdict }];
}

/**
 * A search's state from the engine's own results, in the order they arrived. `ids` are the save points oldest first; the
 * engine (core findGood) checks them newest first, one at a time, and stops at the first that passes. A row shows a verdict
 * only once its result came in; the one being checked is the next older after the last result, while the search runs.
 */
export function checkRun(ids: readonly string[], results: readonly RunResult[], finding: boolean): CheckRun {
  const done = new Map<string, string>();
  for (const r of results) done.set(r.checkpoint, r.verdict);
  const found = results.find((r) => r.verdict === "PASS")?.checkpoint ?? null;
  let checking: string | null = null;
  if (finding && !found) {
    const last = results.at(-1);
    const at = last ? ids.indexOf(last.checkpoint) : ids.length;
    checking = at > 0 ? (ids[at - 1] ?? null) : null;
  }
  return { done, checking, found, n: done.size + (checking ? 1 : 0), of: ids.length };
}

/** A box on screen, in viewport pixels. */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the "Back, in a copy" card starts, relative to its own place: where the row it came from was, kept inside the window,
 * so the card (and Undo in it) is in view from the first frame. Null when the row was not drawn: the card is drawn in place.
 */
export function liftFrom(row: ScreenBox | null, card: ScreenBox, viewH: number): { dx: number; dy: number } | null {
  if (!row) return null;
  const top = Math.min(Math.max(row.top, 0), Math.max(viewH - card.height, 0));
  return { dx: Math.round(row.left - card.left), dy: Math.round(top - card.top) };
}

/** One part of the bring-back moment: the card's glide, one of its two lines, or "Your broken version is safe". */
export interface MomentStep {
  part: "card" | "line" | "safe";
  /** For a line, which one (0 = the branch). */
  index: number;
  keyframes: Keyframe[];
  delay: number;
  duration: number;
  easing: string;
}

/**
 * The bring-back moment (B6 §3.3), over --t-moment. The card lifts 6 px with one step of shadow where the row was, then glides
 * to its place; it only moves, never fades, so Undo in it is there at full opacity from the first frame. Its two lines arrive
 * 60 ms apart by opacity, and "Your broken version is safe" comes last. Undo and Keep it are never part of it. Reduced
 * motion: nothing, the card is in its place. No row on screen: no glide, the lines still arrive.
 */
export function bringBackMoment(from: { dx: number; dy: number } | null, lines: number, reduced: boolean): MomentStep[] {
  if (reduced) return [];
  const steps: MomentStep[] = [];
  // The lift takes the first fifth of the moment; the lines start as the glide does.
  const lift = 0.2;
  const first = Math.round(MOMENT_MS * lift);
  const fade = 220;
  if (from) {
    steps.push({
      part: "card", index: 0, delay: 0, duration: MOMENT_MS, easing: "linear",
      keyframes: [
        { offset: 0, transform: `translate(${from.dx}px, ${from.dy}px)`, filter: "drop-shadow(0 0 0 transparent)", easing: EASE },
        { offset: lift, transform: `translate(${from.dx}px, ${from.dy - LIFT_PX}px)`, filter: "drop-shadow(0 6px 10px rgba(20, 20, 20, .14))", easing: EASE },
        { offset: 1, transform: "none", filter: "drop-shadow(0 0 0 transparent)" },
      ],
    });
  }
  for (let i = 0; i < lines; i++) steps.push({ part: "line", index: i, delay: first + i * LINE_STAGGER_MS, duration: fade, easing: EASE, keyframes: [{ opacity: 0 }, { opacity: 1 }] });
  steps.push({ part: "safe", index: 0, delay: Math.min(first + (lines + 1) * LINE_STAGGER_MS, MOMENT_MS - fade), duration: fade, easing: EASE, keyframes: [{ opacity: 0 }, { opacity: 1 }] });
  return steps;
}

/** Undo (B6 §3.3.5): the card, drawn where it was, shrinks back into its row over --t-glide and goes. Null under reduced motion. */
export function undoReturn(card: ScreenBox, row: ScreenBox | null, reduced: boolean): { keyframes: Keyframe[]; duration: number; easing: string } | null {
  if (reduced || !row || !card.height || !card.width) return null;
  const sx = Math.round((row.width / card.width) * 1e4) / 1e4;
  const sy = Math.round((row.height / card.height) * 1e4) / 1e4;
  return {
    duration: RETURN_MS, easing: EASE,
    keyframes: [{ transform: "none", opacity: 1 }, { transform: `translate(${Math.round(row.left - card.left)}px, ${Math.round(row.top - card.top)}px) scale(${sx}, ${sy})`, opacity: 0 }],
  };
}
