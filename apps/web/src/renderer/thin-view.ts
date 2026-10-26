// Storage > Thin old auto saves: the words and the list for the engine's thin preview. First the count and the space,
// then, on Review, each one with its time and why it can go, then Remove N behind the confirm. The engine decides what
// can go; working, pinned and named save points are never in the list.
import type { ThinPreview } from "../shared/api.js";
import { bytes, esc, plural, when } from "../shared/format.js";
import type { ConfirmCopy } from "./confirm.js";

const ALWAYS = "Working, pinned and named save points always stay.";

/** "13 auto saves can go, about 46.9 KB. Working, pinned and named save points always stay." */
export function thinSummary(p: ThinPreview): string {
  const n = p.remove.length;
  return n ? `${plural(n, "auto save")} can go, about ${bytes(p.bytesFreed)}. ${ALWAYS}` : `No auto saves can go yet. ${ALWAYS}`;
}

/** The Review list: each auto save that would go, its time and the engine's reason. It scrolls, so it can take focus. */
export function thinReview(p: ThinPreview): string {
  return `<ul class="th-list" tabindex="0" aria-label="Auto saves that would go">${p.remove.map((r) => `<li><span class="mono">${esc(when(r.at))}</span><span>${esc(r.reason)}</span></li>`).join("")}</ul>`;
}

/** The confirm before Remove N. */
export function thinConfirm(name: string, p: ThinPreview): ConfirmCopy {
  const n = p.remove.length;
  return {
    action: `Remove ${n}`,
    title: `Remove ${plural(n, "auto save")} from ${name}?`,
    body: `Only the auto saves in the list go, and they cannot be brought back. ${ALWAYS} The history stays on this computer and your folder is not touched.`,
  };
}
