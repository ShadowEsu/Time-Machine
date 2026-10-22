// Entrance timing that survives redraws. The window redraws from state, often several times while
// something is still entering, so an entrance carries on where it was instead of starting over.

/** A new page fades in and rises 8 px over this long. */
export const PAGE_IN_MS = 220;
/** One journal row fades in and rises over this long. */
export const ROW_IN_MS = 260;
/** Journal rows start this far apart... */
export const ROW_STAGGER_MS = 35;
/** ...and the last one starts at most this long after the first, however long the journal is. */
export const ROW_STAGGER_CAP_MS = 300;
/** Sheets, the Rewind, the Inspector and toasts fade out over this long. */
export const LEAVE_MS = 180;

/**
 * The animation delay that shows an entrance `elapsed` ms after it began, for an entrance that
 * starts `start` ms in and runs `duration` ms. Negative means part of it already played. Null
 * when it has finished, so the element is drawn plainly.
 */
export function entranceDelay(start: number, elapsed: number, duration: number): number | null {
  const delay = start - elapsed;
  return delay + duration > 0 ? delay : null;
}

/** The animation delay for journal row `index`, `elapsed` ms after the journal first showed. */
export function rowDelay(index: number, elapsed: number): number | null {
  return entranceDelay(Math.min(index * ROW_STAGGER_MS, ROW_STAGGER_CAP_MS), elapsed, ROW_IN_MS);
}
