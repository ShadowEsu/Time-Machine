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

/** The check step's second sentence: plain when no test command was found, else where the check came from. */
export function checkLede(init: { verifyCommand: string; created: boolean }): string {
  if (!init.verifyCommand.trim()) return "No test command found, so save points can’t be checked yet. Type the command that shows your project works, or pick Build it.";
  return init.created ? "We picked one from your project. Change it if it is not right." : "Your timemachine.yml already has one. Change it if it is not right.";
}
