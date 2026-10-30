// History as a list and a preview (L364 option B): the pure parts, so the app and its tests agree on what is
// selected, what the status line says and where the arrow keys go.
import type { Verdict } from "../shared/api.js";
import { folderCommands } from "./folder-commands.js";

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

/** "a", "a and b", "a, b and c". */
function andList(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What the folder was on before the bring back: its branch, or a detached HEAD at a commit. */
export interface FolderWas {
  branch: string | null;
  sha: string;
}

/** What the engine read in the folder (folderState): files to leave out or force-add, and whether it has commit hooks. */
export interface FolderSecretsIn {
  excluded: readonly string[];
  tracked: readonly string[];
  forceAdd?: readonly string[];
}

/**
 * Everything the "Use it in your folder" panel says, in one place (the app never writes the folder). The commands and the
 * go-back line come from folderCommands() (sequence S3s, proven by FolderCmds' harness in zsh and bash), unchanged: the
 * folder's state is committed on its own side branch tm/folder-before/<id>, secret-looking files left out by literal
 * pathspec, and the folder switches to use-<id>, made from the working version. The names are not checked for collisions
 * here: the engine must pick unused names before this ships. The panel is off unless turned on.
 * `blocked` is set (and there are no commands) when no block can be offered, e.g. a tracked path whose ignored copy looks secret.
 */
export function folderSteps(folder: string, home: string, recoverySha: string, id: string, was: FolderWas, secrets: FolderSecretsIn = { excluded: [], tracked: [] }, copyShown = ""): {
  intro: string; end: string; commands: string; back: string; backNote: string; locked: string; left: string; local: string; blocked: string; why: string[]; onUse: string; hooks: string;
  beforeBack: string; afterBack: string; onError: string;
} {
  const use = `use-${id}`;
  const save = `tm/folder-before/${id}`;
  const made = folderCommands({
    folder, home, id, use, save, recoverySha, orig: was.branch ?? "", ...(was.branch ? {} : { detachedSha: was.sha }),
    excluded: [...secrets.excluded], forceAdd: [...(secrets.forceAdd ?? [])], secretCollisions: [...secrets.tracked],
  });
  const ex = made.offer ? made.leftInPlace : [];
  return {
    intro: "Run these in a terminal. They save your folder’s current state on its own branch, then switch the folder to a new branch made from the working version. These steps delete nothing.",
    end: `You end on a new branch, ${use}, made from the working version. ${was.branch ? `Your old branch, ${was.branch}, is unchanged.` : "The commit you were on is unchanged."}`,
    onError: "If any step stops with an error, run the go-back line.",
    commands: made.offer ? made.commands : "",
    back: made.offer ? made.back : "",
    backNote: `This works after the commands above, or after any of them failed. If it stops at “invalid reference: ${save}”, your folder was never changed. Staged changes come back unstaged.`,
    locked: `If the last step says it cannot lock ${use}, you made commits there. They are kept, and the rest is already back.`,
    left: !ex.length ? "" : ex.length === 1
      ? `We left out ${ex[0]} (looks like a secret). It stays in your folder, untouched.`
      : `We left out ${andList(ex)} (they look like secrets). They stay in your folder, untouched.`,
    local: `${save} is a local safety branch. Don’t push it or merge it. To get your work back, run the go-back line.`,
    hooks: "Your repo’s commit hooks are skipped for these steps so they can’t change files mid-way.",
    beforeBack: `Commit or copy any new edits on ${use} before going back.`,
    afterBack: `Going back deletes only the safety branch ${save}, after your work is back in your folder. The working version stays on ${use}${copyShown ? ` and in the copy at ${copyShown}` : ""}.`,
    blocked: made.offer ? "" : made.reason,
    onUse: `Your folder is on ${use}, the working version. Your broken work is on the branch ${save}.`,
    why: [
      "Hooks are off for these steps, so your project’s hooks can’t change files mid-way.",
      `git add -A saves your broken state on the safety branch${ex.length ? ", except the files we left out (they look like secrets)" : ""}.`,
      "Runs without your repo’s commit hooks or signing; the save commit is authored by Time Machine.",
      "In the go-back line, git branch -D removes only the safety branch, after its changes are back in your folder.",
      "-D, not -d: the safety branch was never merged, so -d would refuse.",
      `git update-ref -d deletes ${use} only while it still points at the working version, so any commits you made there are kept.`,
      "These are macOS and Linux shell commands (zsh, bash).",
    ],
  };
}
