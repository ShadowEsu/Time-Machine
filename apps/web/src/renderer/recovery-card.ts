// History's recovery card (option C, Guided recovery): when the newest save point is Broken, the page leads with the way
// back in three steps. 1 Bring back, 2 Try it, 3 Keep it or undo. This decides which step is current and says the Git
// commands that keep the version, so the app and the tests agree.

/** What this session did on the card: the bring back's result exists, the copy was opened or checked, and Keep it was pressed. */
export interface GuideProgress {
  brought: boolean;
  tried: boolean;
  kept: boolean;
}

/** The current step, 1 to 3, or 0 once the version is kept and the card is done. */
export function guideStep(g: GuideProgress): 0 | 1 | 2 | 3 {
  if (!g.brought) return 1;
  if (g.kept) return 0;
  return g.tried ? 3 : 2;
}

/** A step's state on the card: done, the current one, or waiting for an earlier one. */
export function stepState(step: 1 | 2 | 3, current: 0 | 1 | 2 | 3): "done" | "now" | "later" {
  if (current === 0 || step < current) return "done";
  return step === current ? "now" : "later";
}

/**
 * The two commands that make the brought-back version your folder's own, run in your folder: put every tracked file back as
 * the recovery branch has it (files added since are removed, untracked files stay), then commit that as one new commit.
 * Your work from just before was saved as a save point first, so nothing is lost. The message keeps to plain characters.
 */
export function keepCommands(branch: string, name: string): string[] {
  const plain = name.replace(/[^\w .,:()-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return [`git restore --source=${branch} --staged --worktree -- .`, `git commit -m "${plain ? `Bring back ${plain}` : "Bring back the version that works"}"`];
}

/** Every path changed in the given save points, each once, in the order first seen. */
export function changedSince(changes: ReadonlyMap<string, readonly string[]>, ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) for (const p of changes.get(id) ?? []) out.add(p);
  return [...out];
}

/** A short list of paths: "src/tips.js, package.json and 2 more". Empty when there are none. */
export function pathsLine(paths: readonly string[], max = 2): string {
  if (!paths.length) return "";
  const head = paths.slice(0, max).join(", ");
  const rest = paths.length - max;
  return rest > 0 ? `${head} and ${rest} more` : head;
}
