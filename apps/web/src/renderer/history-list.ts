// History as a list and a preview (L364 option B): the pure parts, so the app and its tests agree on what is
// selected, what the status line says and where the arrow keys go.
import type { Verdict } from "../shared/api.js";

export interface ListPoint {
  id: string;
  verdict: Verdict | null;
}

/** Below this window width History is one pane: the list leads and a row opens its preview as a sheet. */
export const TWO_PANE_MIN = 1024;

/**
 * The row History selects when nothing else is chosen: the last version that works while the newest does not, so the
 * answer and its action show without a click. Otherwise the newest. `pts` are oldest first.
 */
export function defaultPick(pts: readonly ListPoint[], lastWorkingId: string | null): string | null {
  const newest = pts.at(-1);
  if (!newest) return null;
  if (lastWorkingId && newest.verdict !== "PASS" && pts.some((p) => p.id === lastWorkingId)) return lastWorkingId;
  return newest.id;
}

/** The save point it broke at: the first Broken one after the last that works. Null when none is recorded. `pts` are oldest first. */
export function brokeAt<T extends ListPoint>(pts: readonly T[], lastWorkingId: string | null): T | null {
  const i = pts.findIndex((p) => p.id === lastWorkingId);
  if (i < 0) return null;
  return pts.slice(i + 1).find((p) => p.verdict === "FAIL") ?? null;
}

/**
 * The one status line above the list. With a version that works behind a broken newest: "Broken since “A”. “B” still
 * works." Otherwise the status rule's own head and time, said as one line. `broke` and `works` are names as said
 * (a message in quotes, or a time).
 */
export function statusLine(o: { newest: Verdict | null; broke: string | null; works: string | null; head: string; voice: string }): string {
  if (o.newest === "FAIL" && o.works) return `${o.broke ? `Broken since ${o.broke}.` : "Broken."} ${o.works} still works.`;
  return [o.head, o.voice].filter(Boolean).join(" ");
}

/** Where a key moves the selection in a list shown newest first: Down is older, Up is newer, Home the newest, End the oldest. Null for any other key. */
export function listMove(count: number, at: number, key: string): number | null {
  if (!count) return null;
  const last = count - 1;
  const from = Math.min(Math.max(at, 0), last);
  switch (key) {
    case "ArrowDown":
      return Math.min(last, from + 1);
    case "ArrowUp":
      return Math.max(0, from - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return Math.min(last, from + 10);
    case "PageUp":
      return Math.max(0, from - 10);
    default:
      return null;
  }
}

/**
 * The files that changed after a save point, up to now: every path the later save points changed, newest first, each once.
 * `known` is false while a later save point's changes are not read yet. `pts` are oldest first.
 */
export function changedSince(pts: readonly ListPoint[], id: string, changes: ReadonlyMap<string, readonly string[]>): { paths: string[]; known: boolean } {
  const i = pts.findIndex((p) => p.id === id);
  if (i < 0) return { paths: [], known: false };
  const seen = new Set<string>();
  let known = true;
  for (let k = pts.length - 1; k > i; k--) {
    const c = changes.get(pts[k]!.id);
    if (!c) {
      known = false;
      continue;
    }
    for (const f of c) seen.add(f);
  }
  return { paths: [...seen], known };
}

/**
 * Rows in list order with runs of neighbours that share a key folded into the first of the run, which says how many more
 * it holds. A null key never folds, and a run that holds `keep` (the selected row) stays whole so the selection stays shown.
 */
export function foldRepeats<T extends { id: string }>(rows: readonly T[], key: (t: T) => string | null, keep: string | null): { c: T; more: number }[] {
  const out: { c: T; more: number }[] = [];
  for (let i = 0; i < rows.length; ) {
    const k = key(rows[i]!);
    let j = i + 1;
    while (k !== null && j < rows.length && key(rows[j]!) === k) j++;
    const run = rows.slice(i, j);
    if (run.length > 1 && !run.some((r) => r.id === keep)) out.push({ c: run[0]!, more: run.length - 1 });
    else for (const c of run) out.push({ c, more: 0 });
    i = j;
  }
  return out;
}

/** A word quoted for bash and zsh: inside single quotes, a ' written as '\''. */
function quote(word: string): string {
  return `'${word.replace(/'/g, "'\\''")}'`;
}

/** A folder for a shell: under home as ~/'rest' (the tilde outside the quotes, so the shell expands it), else quoted whole. */
export function folderWord(shown: string): string {
  return shown === "~" ? "~" : shown.startsWith("~/") ? `~/${quote(shown.slice(2))}` : quote(shown);
}

/** What the folder was on before the bring back: its branch, or a detached HEAD at a commit. */
export interface FolderWas {
  branch: string | null;
  sha: string;
}

/**
 * Everything the "Use it in your folder" panel says, in one place (the app never writes the folder). Proven in scratch
 * repos (sequence S3: the folder's state is committed on its own side branch, no stash): the working version gets its own
 * branch, use-<id>, because the copy's worktree already has the recovery branch checked out; the folder as it was is kept
 * on tm/folder-before/<id>. Go back works after success or after any failed step. The names are not checked for
 * collisions here: the engine must pick unused names before this ships. The panel is off unless turned on.
 * `shown` is the folder as the app shows it (~ for home), the same text on screen and in the copied block.
 */
export function folderSteps(shown: string, recoveryBranch: string, recoverySha: string, id: string, was: FolderWas): { intro: string; commands: string; back: string; backNote: string } {
  const dir = folderWord(shown);
  const use = `use-${id}`;
  const save = `tm/folder-before/${id}`;
  const quiet = "git -c core.hooksPath=/dev/null";
  const orig = was.branch ?? was.sha;
  return {
    intro: "Run these in a terminal. They save your folder’s current state on its own branch, then switch the folder to a new branch made from the working version. Nothing is deleted.",
    commands: [
      `cd ${dir} &&`,
      `git branch ${use} ${recoveryBranch} &&`,
      `${quiet} switch -c ${save} &&`,
      "git add -A &&",
      `${quiet} -c commit.gpgsign=false -c user.name="Time Machine" -c user.email=tm@localhost commit -q --allow-empty -m "tm: folder before using ${id}" &&`,
      `${quiet} switch ${use}`,
    ].join("\n"),
    back: `cd ${dir} && ${quiet} switch ${save} && git reset -q --soft ${orig} && ${quiet} switch ${was.branch ? was.branch : `--detach ${was.sha}`} && git reset -q && git branch -D ${save} && git update-ref -d refs/heads/${use} ${recoverySha}`,
    backNote: `This works after the commands above, or after any of them failed. If it stops at “invalid reference: ${save}”, your folder was never changed.`,
  };
}
