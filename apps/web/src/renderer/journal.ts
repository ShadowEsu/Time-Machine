// The journal reads like a departure board: when a save point's check came out differently from the
// check before it, its entry says what it was, and when. Pure, so the tests need no window.
import type { Verdict } from "../shared/api.js";

export interface Checked {
  id: string;
  verdict: Verdict | null;
}

/**
 * For each save point whose verdict differs from the last checked save point before it: that earlier
 * save point. Input is oldest first. A save point with no check yet never starts or ends a change, so
 * the comparison reaches past it. A pass followed straight away by a fail is left out, because the
 * journal's "Broke here" line between those two entries already says it.
 */
export function verdictWas<T extends Checked>(oldestFirst: readonly T[]): Map<string, T> {
  const was = new Map<string, T>();
  let last: T | null = null;
  let lastIndex = -1;
  oldestFirst.forEach((c, i) => {
    if (c.verdict === null) return;
    const brokeHere = lastIndex === i - 1 && last?.verdict === "PASS" && c.verdict === "FAIL";
    if (last && last.verdict !== c.verdict && !brokeHere) was.set(c.id, last);
    last = c;
    lastIndex = i;
  });
  return was;
}
