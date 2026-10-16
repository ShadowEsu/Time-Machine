// D06 and D07 logic in the Mac app shell: settings, the corner card rule, the agent pill
// signal, the menu bar dot and window placement. No Electron needed.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AGENT_TURN_STALE_MS, agentTurnStart, dotState, firstRunning, hookCandidates, placeOn, projectVerdict, shouldShowBreakCard, trayVerdicts } from "../src/main/rules.ts";
import { Engine } from "../src/main/engine.ts";
import { AppState } from "../src/main/state.ts";
import { CallSchema, HotkeySchema, SettingsPatchSchema, SettingsSchema } from "../src/shared/api.ts";
import { verdictCard } from "../src/shared/cards.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "tm-desktop-"));

describe("settings", () => {
  test("an empty file gets every default, including the hotkey and the agent pill", () => {
    expect(SettingsSchema.parse({})).toEqual({
      showGitDetails: false,
      overlayCards: true,
      theme: "system",
      onboarded: false,
      simpleRewind: false,
      hotkey: "Control+Alt+T",
      agentPill: true,
    });
  });

  test("settings saved by an older version keep their values and gain the new defaults", () => {
    const old = { showGitDetails: true, overlayCards: false, theme: "dark", onboarded: true, simpleRewind: false };
    expect(SettingsSchema.parse(old)).toMatchObject({ ...old, hotkey: "Control+Alt+T", agentPill: true });
  });

  test("the hotkey needs two modifiers and never takes copy, paste, undo, quit or typing", () => {
    for (const ok of ["Control+Alt+T", "CommandOrControl+Shift+K", "Control+Alt+,", "Command+Option+F5", "Control+Shift+Space"]) expect(HotkeySchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["T", "Shift+T", "Control+", "Control+Control+T", "Hyper+T", "Control+Alt+TT", "Control+Alt+T\nrm"]) expect(HotkeySchema.safeParse(bad).success, bad).toBe(false);
    // One modifier is not enough, even an unusual one.
    for (const bad of ["Alt+Space", "Command+F5", "Control+T"]) expect(HotkeySchema.safeParse(bad).success, bad).toBe(false);
    // Copy, paste, cut, undo, quit, close and select all, with any extra modifier.
    for (const bad of ["Command+Shift+C", "CmdOrCtrl+Alt+V", "Control+Shift+X", "Command+Shift+Z", "Command+Alt+Q", "Command+Option+W", "Control+Alt+A"]) expect(HotkeySchema.safeParse(bad).success, bad).toBe(false);
    // Option with a letter types a character, with or without Shift.
    for (const bad of ["Alt+K", "Option+Shift+K", "Alt+Shift+2"]) expect(HotkeySchema.safeParse(bad).success, bad).toBe(false);
    expect(SettingsPatchSchema.parse({ hotkey: null })).toEqual({ hotkey: null });
  });

  test("a patch never resets what it leaves out, and unknown keys are refused", () => {
    expect(SettingsPatchSchema.parse({ agentPill: false })).toEqual({ agentPill: false });
    expect(SettingsPatchSchema.safeParse({ agentPill: false, secret: "x" }).success).toBe(false);
  });

  test("the store keeps settings across restarts and sets a broken file aside", () => {
    const dir = tmp();
    const a = new AppState(dir);
    a.updateSettings({ hotkey: "Control+Alt+K", agentPill: false });
    expect(new AppState(dir).settings).toMatchObject({ hotkey: "Control+Alt+K", agentPill: false, overlayCards: true });

    writeFileSync(join(dir, "settings.json"), JSON.stringify({ hotkey: "Shift+T" }));
    const b = new AppState(dir);
    expect(b.settings.hotkey).toBe("Control+Alt+T");
    expect(readdirSync(dir).some((f) => f.startsWith("settings.json.broken-"))).toBe(true);
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
    b.updateSettings({ hotkey: null });
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).hotkey).toBeNull();
  });

  test("the new calls are validated like every other call", () => {
    const projectId = "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a10";
    expect(CallSchema.safeParse({ method: "cleanStore", projectId, apply: false }).success).toBe(true);
    expect(CallSchema.safeParse({ method: "cleanStore", projectId }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "cleanStore", projectId: "../x", apply: true, files: [] }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "agents" }).success).toBe(true);
    expect(CallSchema.safeParse({ method: "isolation", extra: 1 }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "setSettings", patch: { hotkey: "Shift+A" } }).success).toBe(false);
  });

  test("cleanup removes only the files the preview showed", () => {
    const projectId = "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a10";
    expect(CallSchema.safeParse({ method: "cleanStore", projectId, apply: true, files: ["logs/cp-0001-1.log"] }).success).toBe(true);
    // Applying without the previewed list is refused, so it can never remove more than was shown.
    expect(CallSchema.safeParse({ method: "cleanStore", projectId, apply: true }).success).toBe(false);
    for (const bad of ["../x", "logs/../manifests/cp-0001.json", "/etc/passwd", "manifests/cp-0001.json", "logs/a/b.log", "logs/.."]) {
      expect(CallSchema.safeParse({ method: "cleanStore", projectId, apply: true, files: [bad] }).success, bad).toBe(false);
    }
  });
});

describe("corner card", () => {
  const ctx = { cardsOn: true, windowFocused: false, findingGood: false };
  const pass = { verdict: "PASS" as const };
  const fail = { verdict: "FAIL" as const };

  test("shows only when the project's verdict turns PASS to FAIL", () => {
    expect(shouldShowBreakCard(pass, fail, ctx)).toBe(true);
    expect(shouldShowBreakCard(fail, fail, ctx)).toBe(false);
    expect(shouldShowBreakCard(null, fail, ctx)).toBe(false);
    expect(shouldShowBreakCard(fail, pass, ctx)).toBe(false);
    expect(shouldShowBreakCard(pass, pass, ctx)).toBe(false);
    expect(shouldShowBreakCard(pass, { verdict: "ERROR" }, ctx)).toBe(false);
    expect(shouldShowBreakCard(pass, { verdict: "INCOMPLETE" }, ctx)).toBe(false);
  });

  test("stays away when cards are off, the window has focus, or the app is searching", () => {
    expect(shouldShowBreakCard(pass, fail, { ...ctx, cardsOn: false })).toBe(false);
    expect(shouldShowBreakCard(pass, fail, { ...ctx, windowFocused: true })).toBe(false);
    expect(shouldShowBreakCard(pass, fail, { ...ctx, findingGood: true })).toBe(false);
  });

  test("a new unchecked save point between the PASS and the FAIL does not hide the break", () => {
    // cp-7 passed, the agent saved cp-8, the stop hook then checked cp-8 and it failed.
    const before = projectVerdict([{ id: "cp-0007", verdict: "PASS" }, { id: "cp-0008", verdict: null }]);
    const after = projectVerdict([{ id: "cp-0007", verdict: "PASS" }, { id: "cp-0008", verdict: "FAIL" }]);
    expect(before).toEqual({ id: "cp-0007", verdict: "PASS" });
    expect(shouldShowBreakCard(before, after, ctx)).toBe(true);
  });

  test("checking an old save point does not change the project's verdict", () => {
    expect(projectVerdict([{ id: "cp-0001", verdict: "FAIL" }, { id: "cp-0002", verdict: "PASS" }, { id: "cp-0003", verdict: null }])).toEqual({ id: "cp-0002", verdict: "PASS" });
    expect(projectVerdict([{ id: "cp-0001", verdict: null }])).toBeNull();
  });

  test("the break card offers Rewind and Show what changed", () => {
    const card = verdictCard("p", "acme", [
      { id: "cp-0002", verdict: "PASS", note: "Added dark mode", createdAt: "2026-10-14T10:42:00Z" },
      { id: "cp-0003", verdict: "FAIL", note: "After agent turn", createdAt: "2026-10-14T11:00:00Z" },
    ], "PASS");
    expect(card?.primary?.label).toBe("Rewind to cp-0002");
    expect(card?.primary?.action).toEqual({ kind: "rewind", projectId: "p", target: "cp-0002" });
    // It only opens Compare. "What broke?" is planned, so the button must not promise it.
    expect(card?.secondary?.label).toBe("Show what changed");
    expect(card?.secondary?.action).toEqual({ kind: "compare", projectId: "p", a: "cp-0002", b: "cp-0003" });
  });
});

describe("agent pill signal", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const at = (minAgo: number): string => new Date(now - minAgo * 60_000).toISOString();

  test("a turn is in progress from the prompt hook until the stop hook", () => {
    expect(agentTurnStart([], now)).toBeNull();
    expect(agentTurnStart([{ at: at(5), action: "agent-turn", result: "started" }, { at: at(4), action: "checkpoint", result: "saved" }], now)).toBe(at(5));
    expect(agentTurnStart([{ at: at(5), action: "agent-turn", result: "started" }, { at: at(1), action: "agent-turn", result: "ended" }], now)).toBeNull();
    expect(agentTurnStart([{ at: at(9), action: "agent-turn", result: "ended" }, { at: at(2), action: "agent-turn", result: "started" }], now)).toBe(at(2));
  });

  test("a turn with no end goes stale after an hour, so the pill never stays forever", () => {
    const stale = new Date(now - AGENT_TURN_STALE_MS).toISOString();
    expect(agentTurnStart([{ at: stale, action: "agent-turn", result: "started" }], now)).toBeNull();
    expect(agentTurnStart([{ at: "not a date", action: "agent-turn", result: "started" }], now)).toBeNull();
  });
});

describe("menu bar dot", () => {
  test("worst state wins, and green needs every newest save point to pass", () => {
    expect(dotState([], false)).toBe("none");
    expect(dotState(["PASS", "PASS"], false)).toBe("pass");
    expect(dotState(["PASS", null], false)).toBe("none");
    expect(dotState(["PASS", "INCOMPLETE"], false)).toBe("none");
    expect(dotState(["PASS", "FAIL"], false)).toBe("fail");
    expect(dotState(["PASS"], true)).toBe("working");
    expect(dotState(["FAIL"], true)).toBe("fail");
  });

  test("a project that moved or has no save points keeps the dot from going green", () => {
    const ok = { projectId: "a", newest: { id: "cp-0002", verdict: "PASS" as const }, lastWorking: null, problem: null };
    const moved = { projectId: "b", newest: null, lastWorking: null, problem: "That folder does not exist." };
    const empty = { projectId: "c", newest: null, lastWorking: null, problem: null };
    expect(dotState(trayVerdicts([ok]), false)).toBe("pass");
    expect(dotState(trayVerdicts([ok, moved]), false)).toBe("none");
    expect(dotState(trayVerdicts([ok, empty]), false)).toBe("none");
  });
});

describe("Claude Code hook command", () => {
  test("prefers the CLI the app can run itself, quoted, then the version pinned npx form", () => {
    const c = hookCandidates({ override: undefined, nodePath: "/Applications/Time Machine.app/Contents/MacOS/Electron", cliScript: "/repo/packages/cli/dist/tm.js", version: "0.1.0" });
    expect(c).toEqual(["ELECTRON_RUN_AS_NODE=1 '/Applications/Time Machine.app/Contents/MacOS/Electron' '/repo/packages/cli/dist/tm.js'", "npx -y timetm@0.1.0"]);
    expect(hookCandidates({ override: undefined, nodePath: "/x/Electron", cliScript: null, version: "0.1.0" })).toEqual(["npx -y timetm@0.1.0"]);
    // Never the unpinned name, which anyone could publish.
    for (const cmd of c) expect(cmd).not.toMatch(/timetm(\s|$)/);
    expect(hookCandidates({ override: "tm", nodePath: "/x/Electron", cliScript: "/repo/tm.js", version: "0.1.0" })).toEqual(["tm"]);
  });

  test("uses the first command that runs, and says so when none does", async () => {
    const probe = async (cmd: string): Promise<boolean> => cmd === "b" || cmd === "c";
    expect(await firstRunning(["a", "b", "c"], probe)).toEqual({ command: "b", runs: true });
    expect(await firstRunning(["a", "d"], probe)).toEqual({ command: "d", runs: false });
  });
});

describe("engine guards", () => {
  const setup = (candidates: string[]): { engine: Engine; projectId: string; dir: string } => {
    const dir = tmp();
    const state = new AppState(join(dir, "app"));
    const projectId = "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a10";
    state.projects.push({ id: projectId, path: dir, name: "acme", addedAt: "2026-10-15T00:00:00Z", demo: false });
    return { engine: new Engine(state, { candidates, version: "9.9.9" }), projectId, dir };
  };

  test("undo of a rewind only touches a recovery copy this app made", async () => {
    const { engine, projectId } = setup(["false"]);
    const r = await engine.run({ method: "undoRecover", projectId, id: "cp-0001", branch: "tm/recover/cp-0001", copyDir: join(tmp(), "unrelated") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/not a recovery copy this app made/);
  });

  test("the hook lines use a command that answers with this version", async () => {
    const { engine, projectId, dir } = setup(["false", "echo 9.9.9 #"]);
    const r = await engine.run({ method: "hookPreview", projectId });
    expect(r.ok && r.data).toMatchObject({ command: "echo 9.9.9 #", runs: true, settingsPath: join(dir, ".claude", "settings.json") });
  });

  test("nothing is written when the hook command does not run", async () => {
    const { engine, projectId, dir } = setup(["false", "echo 1.0.0 #"]);
    const preview = await engine.run({ method: "hookPreview", projectId });
    expect(preview).toMatchObject({ ok: true, data: { runs: false } });
    const r = await engine.run({ method: "hookInstall", projectId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/does not run/);
    expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(false);
  });
});

describe("window placement", () => {
  const area = { x: 1440, y: 25, width: 1920, height: 1055 };

  test("a window on another display is centered on the target display", () => {
    expect(placeOn(area, { x: 100, y: 100, width: 1280, height: 800 })).toEqual({ x: 1760, y: 153, width: 1280, height: 800 });
  });

  test("a window already inside stays put, and a big one is shrunk to fit", () => {
    expect(placeOn(area, { x: 1500, y: 40, width: 1280, height: 800 })).toEqual({ x: 1500, y: 40, width: 1280, height: 800 });
    expect(placeOn({ x: 0, y: 0, width: 1000, height: 700 }, { x: 0, y: 0, width: 1280, height: 800 })).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
  });
});
