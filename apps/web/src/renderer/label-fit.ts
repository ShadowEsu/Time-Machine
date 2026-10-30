// Labels that must never sit on each other or on a verdict glyph. The window measures the boxes after
// each draw; this decides where each label goes, so the rule can be tested without a window.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether two boxes touch, or come closer than `gap`. */
export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

/** A w by h box centred on x, y. */
export const boxAround = (x: number, y: number, w: number, h: number): Box => ({ left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 });

/**
 * For each label, most important first, the first of its candidate boxes that stays inside the frame,
 * clear of every obstacle and at least `gap` from every label already placed. Null means it is hidden:
 * a less important label gives way, never the other way round.
 */
export function placeLabels(labels: readonly (readonly Box[])[], frame: Box, obstacles: readonly Box[], gap: number): (number | null)[] {
  const placed: Box[] = [];
  return labels.map((candidates) => {
    const k = candidates.findIndex(
      (b) => b.left >= frame.left && b.right <= frame.right && b.top >= frame.top && b.bottom <= frame.bottom && !obstacles.some((o) => overlaps(b, o)) && !placed.some((p) => overlaps(b, p, gap)),
    );
    if (k < 0) return null;
    placed.push(candidates[k] as Box);
    return k;
  });
}

/**
 * Where a dial label may go, for a dot at `dot` on a dial centred at `center`, `gap` from the dot's centre.
 * At the sides (|sin| of its angle over 0.7) it goes above its dot, anchored toward the centre: a label on
 * the right ends at its dot, one on the left starts at it. At the top and bottom it sits just outside its
 * dot. The other places are fallbacks for a crowded dial. Each is kept inside `frame` sideways.
 */
export function dialCandidates(dot: { x: number; y: number }, center: { x: number; y: number }, w: number, h: number, gap: number, frame: Box): Box[] {
  const dx = dot.x - center.x;
  const dy = dot.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const reach = gap + (Math.abs(ux) * w) / 2 + (Math.abs(uy) * h) / 2;
  const x = Math.min(Math.max(dot.x, frame.left + w / 2), frame.right - w / 2);
  const outward = boxAround(dot.x + ux * reach, dot.y + uy * reach, w, h);
  const inward = boxAround(dot.x - ux * reach, dot.y - uy * reach, w, h);
  if (Math.abs(ux) > 0.7) {
    const toCentre = ux > 0 ? dot.x - w / 2 : dot.x + w / 2;
    return [boxAround(toCentre, dot.y - gap - h / 2, w, h), boxAround(toCentre, dot.y + gap + h / 2, w, h), outward, inward];
  }
  const above = boxAround(x, dot.y - gap - h / 2, w, h);
  const below = boxAround(x, dot.y + gap + h / 2, w, h);
  return [outward, ...(uy <= 0 ? [above, below] : [below, above]), inward];
}
