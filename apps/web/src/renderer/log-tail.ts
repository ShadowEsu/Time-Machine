// The end of what a check printed, inside the check block. Pure, so the window and the tests agree. The engine
// already cleaned the lines (escapes, controls, secrets); every line still goes through esc() here, and nothing else
// is built from the log. The lines are shown and copied only: never sent to Ask, a report or an export.
import type { LogTail } from "../shared/api.js";
import { esc } from "../shared/format.js";

/** One check log's end, as the window holds it while it is read. */
export type LogTailView = { state: "loading" } | { state: "done"; tail: LogTail | null } | { state: "error" };

/** The ways common test runners mark a failed test, each capturing the test's name. */
const FAILED: readonly RegExp[] = [
  // node --test and Mocha-like reporters: "✖ price multiplies (3.68ms)". Node's own summary header is not a test.
  /^\s*[✖✗×]\s+(?!failing tests:?\s*$)(.+?)(?:\s+\([\d.]+\s*m?s\))?\s*$/u,
  // TAP: "not ok 2 - multiplies", "not ok 3 rounds # TODO".
  /^\s*not ok\s+\d+\s*(?:-\s*)?(.+?)(?:\s+#.*)?\s*$/,
  // Jest and Vitest: "FAIL src/price.test.js", " FAIL  src/b.test.ts > rounds".
  /^\s*FAIL\s+(.+?)\s*$/,
  // Jest's detail header: "● price › multiplies". "● Console" is Jest's console block, not a test.
  /^\s*●\s+(?!Console\s*$)(.+?)\s*$/u,
];

/** The names of the tests a log says failed, in the order first seen, each once. Empty when the log names none. */
export function failingTests(lines: readonly string[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    for (const re of FAILED) {
      const name = re.exec(line)?.[1]?.trim();
      if (name) {
        if (!names.includes(name)) names.push(name);
        break;
      }
    }
  }
  return names;
}

/** "Failing: a, b, c and 2 more", or "" when no test is named. */
export function failingLine(names: readonly string[]): string {
  if (!names.length) return "";
  const shown = names.slice(0, 3).join(", ");
  return `Failing: ${shown}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
}

/**
 * The block for one check run. `log` is that run's log path: a newer run's log is never shown for an older verdict.
 * While it is read it says so (under load a read can take seconds), and nothing when the check stored no output.
 * The failing tests' names, when the lines name any, lead the block.
 */
export function tailHtml(log: string, view: LogTailView | undefined): string {
  if (!view || view.state === "loading") return '<p class="cw-n">Reading the end of what it printed…</p>';
  if (view.state === "error") return '<p class="cw-n">That log couldn’t be read.</p>';
  const t = view.tail;
  if (!t || t.log !== log) return "";
  if (t.binary) return '<p class="cw-n">The end of the log isn’t text, so it isn’t shown.</p>';
  if (t.hidden) return '<p class="cw-n">The end of the log looked like it held a secret, so it isn’t shown.</p>';
  if (!t.lines.length) return '<p class="cw-n">The check printed nothing.</p>';
  const text = t.lines.join("\n");
  const failing = failingLine(failingTests(t.lines));
  return `${failing ? `<p class="cw-f">${esc(failing)}</p>` : ""}<div class="cw-o"><div class="cw-oh"><span>The end of what it printed</span><button class="btn link small" data-act="copy" data-text="${esc(text)}">Copy these lines</button></div>
    <pre class="cw-out" tabindex="0" aria-label="The end of what the check printed">${esc(text)}</pre></div>`;
}
