// The end of what a check printed, inside the check block. Pure, so the window and the tests agree. The engine
// already cleaned the lines (escapes, controls, secrets); every line still goes through esc() here, and nothing else
// is built from the log. The lines are shown and copied only: never sent to Ask, a report or an export.
import type { LogTail } from "../shared/api.js";
import { esc } from "../shared/format.js";

/** One check log's end, as the window holds it while it is read. */
export type LogTailView = { state: "loading" } | { state: "done"; tail: LogTail | null } | { state: "error" };

/**
 * The block for one check run. `log` is that run's log path: a newer run's log is never shown for an older verdict.
 * Nothing while it is read, and nothing when the check stored no output.
 */
export function tailHtml(log: string, view: LogTailView | undefined): string {
  if (!view || view.state === "loading") return "";
  if (view.state === "error") return '<p class="cw-n">That log couldn’t be read.</p>';
  const t = view.tail;
  if (!t || t.log !== log) return "";
  if (t.binary) return '<p class="cw-n">The end of the log isn’t text, so it isn’t shown.</p>';
  if (t.hidden) return '<p class="cw-n">The end of the log looked like it held a secret, so it isn’t shown.</p>';
  if (!t.lines.length) return '<p class="cw-n">The check printed nothing.</p>';
  const text = t.lines.join("\n");
  return `<div class="cw-o"><div class="cw-oh"><span>The end of what it printed</span><button class="btn link small" data-act="copy" data-text="${esc(text)}">Copy these lines</button></div>
    <pre class="cw-out" tabindex="0" aria-label="The end of what the check printed">${esc(text)}</pre></div>`;
}
