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
/** A verdict that changed on screen (Not checked yet to Works or Broken) settles in over this long, without overshoot. */
export const VERDICT_MS = 320;
/** A sheet, column or stamp redrawn this soon after it entered carries its entrance on instead of losing it. */
export const ENTER_KEEP_MS = 340;

/** The animation delay for a page's block `index` (0 = the first), `elapsed` ms after the page appeared. */
export function blockDelay(index: number, elapsed: number, duration: number): number | null {
  return entranceDelay(Math.min(index, BLOCK_STAGGER_MAX) * BLOCK_STAGGER_MS, elapsed, duration);
}
