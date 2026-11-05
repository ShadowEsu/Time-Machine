// The first run: the last onboarding step is one click to finish, with or without Claude Code,
// and Try the demo in the preview rescues the story the same way the engine does. Synthetic data.
import { describe, expect, test } from "vitest";
import { DISCONNECTED, type HookPreview } from "../src/shared/api.ts";
import { checkLede, connectionText, hookStepActions, setupStrip, welcomePage } from "../src/renderer/first-run.ts";
import { FakeEngine } from "../preview/fake.ts";

const hook = (runs: boolean, plugin = false): HookPreview => ({
  settingsPath: "/Users/you/code/acme/.claude/settings.json",
  command: "tm",
  runs,
  plugin,
  lines: [{ event: "Stop", command: "tm hook stop" }],
});

describe("Welcome", () => {
  const html = welcomePage({ code: false, where: "this Mac", buddy: "<i class=\"buddy\"></i>", addKey: "⌘N" });

  test("no greeting: the page starts with what it is for", () => {
    expect(html).not.toMatch(/Good (morning|afternoon|evening)/);
    expect(html).not.toContain("wl-hello");
  });

  test("Try the demo is the one primary, first; Protect a folder is the quiet second with its shortcut", () => {
    expect(html.indexOf('data-act="demo"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-act="demo"')).toBeLessThan(html.indexOf('data-act="add"'));
    expect(html).toMatch(/<button class="wl-demo wl-primary" data-act="demo">/);
    expect(html).toMatch(/<button class="btn quiet wl-add" data-act="add">Protect a folder<kbd>⌘N<\/kbd><\/button>/);
    expect(html).not.toMatch(/class="btn (dark|big)/);
    expect(html.match(/wl-primary/g)?.length).toBe(1);
  });

  test("Good to know stays, and the footer is one plain line", () => {
    expect(html).toContain('id="wl-know-h"');
    expect(html).not.toContain("Local browser app");
  });
});

describe("the disconnected banner", () => {
  test("connected, or nothing known yet: no banner", () => {
    expect(connectionText(null)).toBeNull();
    expect(connectionText({ state: "connected" })).toBeNull();
  });

  test("a lost connection says the history is safe and both ways back, and says Disconnected once", () => {
    for (const c of [{ state: "disconnected" as const, message: DISCONNECTED }, { state: "disconnected" as const }]) {
      const t = connectionText(c);
      expect(t?.line).toBe(DISCONNECTED);
      expect(t?.line).toMatch(/safe/);
      expect(t?.line).toMatch(/Reconnect/);
      expect(t?.line).toMatch(/new link/);
      expect(t?.title).toMatch(/^Disconnected from tm ui$/);
      expect(t?.line).not.toMatch(/Disconnected/);
    }
  });

  test("a link without its token keeps the bridge's own sentence", () => {
    const reopen = "Open the full URL printed by tm ui, including its #token fragment, to connect this browser.";
    expect(connectionText({ state: "disconnected", message: reopen })?.line).toBe(reopen);
  });
});

describe("the last onboarding step", () => {
  test("with lines ready, one click connects and finishes, and one click skips", () => {
    expect(hookStepActions(hook(true), false)).toEqual({
      primary: { act: "ob-connect-finish", label: "Connect Claude Code and finish" },
      skip: "Skip, finish without it",
    });
  });

  test("with nothing to add, Finish is the only button", () => {
    const finishOnly = { primary: { act: "ob-finish", label: "Finish" }, skip: null };
    // Already connected.
    expect(hookStepActions(hook(true), true)).toEqual(finishOnly);
    // The lines could not be prepared.
    expect(hookStepActions(null, false)).toEqual(finishOnly);
    // The command does not run on this Mac, so the app adds nothing.
    expect(hookStepActions(hook(false), false)).toEqual(finishOnly);
    // The Claude Code plugin already covers the project once its check is approved, so no lines are added.
    expect(hookStepActions(hook(true, true), false)).toEqual(finishOnly);
  });
});

describe("the setup strip on History", () => {
  test("stays until the first verdict, then goes once Claude Code is connected or it is hidden", () => {
    // Added, not checked yet: Check it works is the current step, and it can't be hidden yet.
    expect(setupStrip({ verdict: false, connected: false, hidden: false })).toEqual({ check: "current", connect: "todo", canHide: false });
    // Hiding before any check does not skip the check.
    expect(setupStrip({ verdict: false, connected: false, hidden: true })).not.toBeNull();
    // Connected first: the strip still waits for the first verdict.
    expect(setupStrip({ verdict: false, connected: true, hidden: false })).toEqual({ check: "current", connect: "done", canHide: false });
    // Checked, not connected: Connect Claude Code is the current step, and Hide is offered.
    expect(setupStrip({ verdict: true, connected: false, hidden: false })).toEqual({ check: "done", connect: "current", canHide: true });
    expect(setupStrip({ verdict: true, connected: false, hidden: true })).toBeNull();
    expect(setupStrip({ verdict: true, connected: true, hidden: false })).toBeNull();
    // While the connection is still being read, a checked project shows nothing rather than flash the strip.
    expect(setupStrip({ verdict: true, connected: null, hidden: false })).toBeNull();
  });
});

describe("the check step", () => {
  test("with no test command found it says so plainly; otherwise it says where the check came from", () => {
    expect(checkLede({ verifyCommand: "", created: true })).toBe("No test command found, so save points can’t be checked yet. Type the command that shows your project works.");
    expect(checkLede({ verifyCommand: "", created: true }, true)).toBe("No test command found, so save points can’t be checked yet. Type the command that shows your project works, or pick Build it.");
    expect(checkLede({ verifyCommand: "  ", created: false })).toMatch(/^No test command found/);
    expect(checkLede({ verifyCommand: "npm test", created: true })).toBe("We picked one from your project. Change it if it is not right.");
    expect(checkLede({ verifyCommand: "npm test", created: false })).toBe("Your timemachine.yml already has one. Change it if it is not right.");
  });
});

describe("Try the demo in the preview", () => {
  test("builds the broken story, finds the last working version and recovers it like the engine", async () => {
    const fake = new FakeEngine("new", "off");
    expect(await fake.call({ method: "bootstrap" })).toMatchObject({ ok: true, data: { projects: [] } });
    const r = await fake.call({ method: "demo" });
    if (!r.ok) throw new Error(r.error.message);
    const { findGood, recover } = r.data.result;
    expect(findGood).toMatchObject({ verdict: "PASS", found: "cp-0003" });
    expect(findGood.tried.map((t) => t.verdict)).toEqual(["FAIL", "FAIL", "FAIL", "PASS"]);
    expect(recover).toMatchObject({ id: "cp-0003", branch: "tm/recover/cp-0003", pushed: false });
    // Every recovery says what did not come back.
    expect(recover.notRestored.length).toBeGreaterThan(0);
    expect(await fake.call({ method: "statuses" })).toMatchObject({ ok: true, data: [{ lastWorking: { id: "cp-0003" } }] });
    // The app undoes the demo's own recovery, so the user's Go back makes the one recovery branch.
    expect(await fake.call({ method: "undoRecover", projectId: fake.project.id, id: recover.id, branch: recover.branch, copyDir: recover.copyDir })).toMatchObject({ ok: true });
    expect(await fake.call({ method: "recover", projectId: fake.project.id, id: "cp-0003" })).toMatchObject({ ok: true, data: { branch: "tm/recover/cp-0003" } });
    // The demo runs once per page.
    expect(await fake.call({ method: "demo" })).toMatchObject({ ok: false });
  });

  test("the other stories already are the demo, so they refuse", async () => {
    expect(await new FakeEngine("broken", "off").call({ method: "demo" })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/This preview is the demo/) } });
  });
});
