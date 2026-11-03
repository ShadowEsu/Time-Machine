// Scrubbing the Rewind's ruler: where each save point's tick sits, which tick a pointer is nearest, and where
// a key step lands, so a drag always picks the tick under the finger. Pure, so the tests need no window.

/** A tick's place on the Rewind's ruler, in percent: each save point in the middle of its own slot. */
export function sceneX(i: number, n: number): number {
  return ((i + 0.5) / n) * 100;
}

/** The tick nearest to `p`, on the same scale as `xs`. A pointer exactly between two picks the older one. */
export function nearestTick(xs: readonly number[], p: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs((xs[i] ?? 0) - p) < Math.abs((xs[best] ?? 0) - p)) best = i;
  }
  return best;
}

export type Step = "back" | "forward" | "prevChange" | "nextChange" | "first" | "last";

/**
 * Where a step from `i` lands, oldest first. `keys` are the verdicts as shown; "none" is a save point
 * never checked. A change step goes to the nearest checked save point whose verdict differs from this
 * one, so unchecked saves never hide a change: back from Broken it lands on the newest that works
 * ("where did it go red?"); forward, on the first after the change. Never past either end.
 */
export function stepIndex(keys: readonly string[], i: number, how: Step): number {
  const n = keys.length;
  if (!n) return 0;
  let j = i;
  if (how === "back") j = i - 1;
  else if (how === "forward") j = i + 1;
  else if (how === "first") j = 0;
  else if (how === "last") j = n - 1;
  else {
    const d = how === "prevChange" ? -1 : 1;
    j = i + d;
    while (j > 0 && j < n - 1 && (keys[j] === "none" || keys[j] === keys[i])) j += d;
  }
  return Math.max(0, Math.min(n - 1, j));
}

/** Time into an ease-in-out glide (CSS cubic-bezier(.65, 0, .35, 1), the cubic in-out) at which it has covered `share` of its way. */
export function glideTime(share: number, ms: number): number {
  const p = Math.max(0, Math.min(1, share));
  const t = p < 0.5 ? Math.cbrt(p / 4) : 1 - Math.cbrt(2 * (1 - p)) / 2;
  return Math.round(t * ms);
}

/**
 * When the Rewind opens, the playhead glides from Now (the right edge) to save point `cur`. Each
 * tick it passes on the way gives a small flick at the moment the playhead crosses it. Returns the
 * delay for each tick it crosses, by index; the tick it lands on and older ones are not crossed.
 */
export function crossings(xs: readonly number[], cur: number, ms: number, from = 100): Map<number, number> {
  const out = new Map<number, number>();
  const end = xs[cur];
  if (end === undefined || from <= end) return out;
  for (let i = cur + 1; i < xs.length; i++) {
    const x = xs[i] ?? from;
    if (x < from) out.set(i, glideTime((from - x) / (from - end), ms));
  }
  return out;
}
