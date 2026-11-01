// Onboarding copy and buttons, the Welcome page and the connection banner's words, decided from what the app knows. Pure, so
// the window and the tests agree. Finish is always one click away.
import { DISCONNECTED, type HookPreview } from "../shared/api.js";
import { esc } from "../shared/format.js";

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

/**
 * First run (Welcome), B's layout: the buddy beside the display line and the voice line, no greeting. Try the demo is the one
 * primary (the ink card), Protect a folder the quiet second with its shortcut, then how it works and Good to know (Design A8).
 * `buddy` is the hero mark's markup and `addKey` the Protect shortcut as shown ("⌘N").
 */
export function welcomePage({ code, where, buddy, addKey }: { code: boolean; where: string; buddy: string; addKey: string }): string {
  const arrow = '<svg class="wl-arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h11M11 5.5 15.5 10 11 14.5"/></svg>';
  const play = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7.2 5.6v8.8l7-4.4z" fill="currentColor"/></svg>';
  // Agents, tests and branches only once a code project is here; until then, words true for any folder (writer#24).
  const words = welcomeWords(code, where);
  return `<div class="welcome wl"><div class="wl-in">
    <header class="wl-hi">${buddy}<div class="wl-t"><h1>Let’s keep your work safe.</h1><p class="voice welcome-v">Get back the version that worked.</p></div></header>
    <button class="wl-demo wl-primary" data-act="demo"><span class="wl-demo-ic">${play}</span><span class="wl-demo-t"><b>Try the demo</b><span>Marigold Tips in a temporary folder, broken on purpose. Your projects are not touched.</span></span>${arrow}</button>
    <div class="wl-own"><button class="btn quiet wl-add" data-act="add">Protect a folder<kbd>${esc(addKey)}</kbd></button><p>Code, documents, research or an agent’s workspace. Any folder works. Git is not needed.</p></div>
    <div class="wl-cols">
      <section aria-labelledby="wl-how-h"><h2 id="wl-how-h">How it works</h2><ol class="wl-steps">
        ${words.how.map(([t, line]) => `<li><b>${esc(t)}</b><span>${esc(line)}</span></li>`).join("")}</ol></section>
      <section aria-labelledby="wl-know-h"><h2 id="wl-know-h">Good to know</h2><ul class="wl-know">
        ${words.know.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></section>
    </div>
    <p class="foot local-note">Keep <span class="mono">tm ui</span> running in your terminal.</p>
  </div></div>`;
}

/** The banner over the app while tm ui can't be reached: null when connected (or not known yet), else its title and line.
 *  A lost connection says the history is safe and both ways back (Design A10); a link without its token keeps the bridge's
 *  own sentence. */
export function connectionText(c: { state: "connecting" | "connected" | "disconnected"; message?: string } | null): { title: string; line: string } | null {
  if (!c || c.state === "connected") return null;
  if (c.state === "connecting") return { title: "Connecting to your local app", line: c.message ?? "Keep tm ui running in your terminal. Live history and actions need that connection." };
  return { title: "Disconnected from tm ui", line: c.message ?? DISCONNECTED };
}
