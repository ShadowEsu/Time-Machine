// Onboarding copy and buttons, decided from what the app knows. Pure, so the window and the tests
// agree. Finish is always one click away.
import type { HookPreview } from "../shared/api.js";

export interface HookStepActions {
  /** The filled button. "ob-connect-finish" adds the lines, then finishes. */
  primary: { act: "ob-connect-finish" | "ob-finish"; label: string };
  /** A quiet way to finish without adding the lines, or null when there is nothing to skip. */
  skip: string | null;
}

/**
 * With lines ready to add and a command that runs, the filled button connects and finishes in one
 * click, and skipping is one quiet click. Already connected, the plugin already on, no lines (the
 * preview failed), or a command that does not run: there is nothing to add, so the only button is Finish.
 */
export function hookStepActions(hook: HookPreview | null, connected: boolean): HookStepActions {
  if (connected || !hook || hook.plugin || !hook.runs) return { primary: { act: "ob-finish", label: "Finish" }, skip: null };
  return { primary: { act: "ob-connect-finish", label: "Connect Claude Code and finish" }, skip: "Skip, finish without it" };
}

/** The check step's second sentence: plain when no test command was found, else where the check came from. Build it is named only when it is offered. */
export function checkLede(init: { verifyCommand: string; created: boolean }, build = false): string {
  if (!init.verifyCommand.trim()) return `No test command found, so save points can’t be checked yet. Type the command that shows your project works${build ? ", or pick Build it" : ""}.`;
  return init.created ? "We picked one from your project. Change it if it is not right." : "Your timemachine.yml already has one. Change it if it is not right.";
}

/** Where a project is in its setup, for the strip on History. The project is added once it has a save point. */
export interface SetupStrip {
  check: "current" | "done";
  connect: "todo" | "current" | "done";
  /** "Hide" is offered once a check has run, so hiding never skips the one step that proves anything. */
  canHide: boolean;
}

/**
 * The setup strip stays until the project has its first verdict and either Claude Code is connected or
 * the person hid it. `connected` is null while the connection is still being read: with a verdict in,
 * the strip waits rather than flashing up for a project that turns out to be connected.
 */
export function setupStrip(s: { verdict: boolean; connected: boolean | null; hidden: boolean }): SetupStrip | null {
  if (s.verdict && (s.connected !== false || s.hidden)) return null;
  return { check: s.verdict ? "done" : "current", connect: s.connected ? "done" : s.verdict ? "current" : "todo", canHide: s.verdict };
}

/**
 * Welcome's How it works and Good to know. With a code project they speak of agents, tests and branches; without one they
 * say the same in folder words, true for any folder (writer#24). `where` is "this Mac" or "this computer".
 */
export function welcomeWords(code: boolean, where: string): { how: [string, string][]; know: string[] } {
  const undo = "Time Machine is not universal undo: every result says what was not restored.";
  return code
    ? {
        how: [
          ["Save", "Time Machine saves your project before your agent acts."],
          ["Check", "Each save point, with your own tests, in a copy."],
          ["Bring back", "When something breaks, it brings back the newest one that passes, on a new branch."],
        ],
        know: [`Runs on ${where}. Your project is not uploaded.`, "Your folder and branch are not touched.", undo],
      }
    : {
        how: [
          ["Save", "Time Machine saves your folder as you work, and whenever you press Save now."],
          ["Look back", `Your save points stay on ${where}. Open one to see what changed.`],
          ["Bring back", "Pick the version you want. It comes back as a copy next to your folder."],
        ],
        know: [`Runs on ${where}. Your files are not uploaded.`, "Your folder is not touched.", undo],
      };
}
