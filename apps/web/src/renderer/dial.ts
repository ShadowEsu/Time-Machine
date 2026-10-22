// The Rewind dial: save points sit on detents around a 270 degree arc, oldest at the lower left,
// newest at the lower right. Turning it only moves the selection. It never starts a rewind.

export const DIAL_START = -135;
export const DIAL_SPAN = 270;

/** The angle of detent `i` of `n`, in degrees clockwise from straight up. */
export function dialAngle(i: number, n: number): number {
  return n < 2 ? 0 : DIAL_START + (DIAL_SPAN * i) / (n - 1);
}

/** The detent nearest to a pointer at (dx, dy) from the dial's centre, with y pointing down. */
export function dialIndex(dx: number, dy: number, n: number): number {
  if (n < 2) return 0;
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const clamped = Math.max(DIAL_START, Math.min(DIAL_START + DIAL_SPAN, a));
  return Math.round(((clamped - DIAL_START) / DIAL_SPAN) * (n - 1));
}
