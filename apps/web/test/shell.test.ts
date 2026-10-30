// App shell logic: settings, project status rules and the hook command. No browser needed.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { NPM_PUBLISHED } from "@timetm/core";
import { AGENT_TURN_STALE_MS, agentTurnStart, firstRunning, hookCandidates } from "../src/server/rules.ts";
import { Credentials } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";
import { CallSchema, SettingsPatchSchema, SettingsSchema } from "../src/shared/api.ts";
import { clock, dayLabel, homeHtml, homePath, namePoint, pointClock, pointMessage, pointTitle, when } from "../src/shared/format.ts";
import { clockParts, goBackLabel, passStreaks, projectStatus, railAge } from "../src/renderer/status.ts";
import { filterPalette, reduceMotionItem, type PaletteItem } from "../src/renderer/palette.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "tm-desktop-"));

describe("settings", () => {
  test("an empty file gets every default", () => {
    expect(SettingsSchema.parse({})).toEqual({
      showGitDetails: false,
      theme: "system",
      onboarded: false,
      simpleRewind: false,
      verdictTipSeen: false,
      setupHidden: [],
      reduceMotion: false,
    });
  });

  test("settings saved by the Mac app keep their values and drop the desktop-only keys", () => {
    const old = { showGitDetails: true, theme: "system", onboarded: true, simpleRewind: false };
    expect(SettingsSchema.parse({ ...old, overlayCards: false, hotkey: "Control+Alt+T", agentPill: true })).toEqual({ ...old, verdictTipSeen: false, setupHidden: [], reduceMotion: false });
  });

  test("a patch never resets what it leaves out, and unknown keys are refused", () => {
    expect(SettingsPatchSchema.parse({ theme: "light" })).toEqual({ theme: "light" });
    expect(SettingsPatchSchema.safeParse({ theme: "light", secret: "x" }).success).toBe(false);
    for (const removed of [{ hotkey: "Control+Alt+T" }, { overlayCards: true }, { agentPill: false }]) {
      expect(SettingsPatchSchema.safeParse(removed).success, JSON.stringify(removed)).toBe(false);
    }
  });

  test("the store keeps settings across restarts and sets a broken file aside", () => {
    const dir = tmp();
    const a = new AppState(dir);
    a.updateSettings({ theme: "light", showGitDetails: true });
    expect(new AppState(dir).settings).toMatchObject({ theme: "light", showGitDetails: true, onboarded: false });

    writeFileSync(join(dir, "settings.json"), JSON.stringify({ theme: "purple" }));
    const b = new AppState(dir);
    expect(b.settings.theme).toBe("system");
    expect(readdirSync(dir).some((f) => f.startsWith("settings.json.broken-"))).toBe(true);
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
    b.updateSettings({ theme: "system" });
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).theme).toBe("system");
  });

  test("the new calls are validated like every other call", () => {
    const projectId = "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a10";
    expect(CallSchema.safeParse({ method: "cleanStore", projectId, apply: false }).success).toBe(true);
    expect(CallSchema.safeParse({ method: "cleanStore", projectId }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "cleanStore", projectId: "../x", apply: true, files: [] }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "agents" }).success).toBe(true);
    expect(CallSchema.safeParse({ method: "isolation", extra: 1 }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "setSettings", patch: { hotkey: "Control+Alt+T" } }).success).toBe(false);
    for (const removed of ["chooseFolder", "reveal"]) expect(CallSchema.safeParse({ method: removed }).success, removed).toBe(false);
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

describe("rail ages", () => {
  test("say how long ago in plain words: just now, minutes, hours today, Yesterday, days, then the date", () => {
    const now = new Date(2026, 9, 25, 15, 0).getTime();
    const at = (d: number, h: number, m: number): string => new Date(2026, 9, d, h, m).toISOString();
    expect(railAge(at(25, 14, 59), now)).toBe("1 min");
    expect(railAge(new Date(now - 20_000).toISOString(), now)).toBe("just now");
    expect(railAge(at(25, 14, 57), now)).toBe("3 min");
    expect(railAge(at(25, 13, 0), now)).toBe("2 h");
    expect(railAge(at(24, 23, 30), now)).toBe("Yesterday");
    expect(railAge(at(21, 9, 0), now)).toBe("4 days");
    expect(railAge(at(1, 9, 0), now)).toBe(new Date(2026, 9, 1).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
  });

  test("journal days: Today, Yesterday, the weekday for the rest of the last 7 days, then the date (with the year when not this year)", () => {
    const now = new Date(2026, 9, 25, 15, 0);
    const at = (y: number, mo: number, d: number, h = 9): string => new Date(y, mo, d, h, 0).toISOString();
    expect(dayLabel(at(2026, 9, 25, 0), now)).toBe("Today");
    expect(dayLabel(at(2026, 9, 24, 23), now)).toBe("Yesterday");
    expect(dayLabel(at(2026, 9, 21), now)).toBe(new Date(2026, 9, 21).toLocaleDateString(undefined, { weekday: "long" }));
    expect(dayLabel(at(2026, 9, 19), now)).toBe(new Date(2026, 9, 19).toLocaleDateString(undefined, { weekday: "long" }));
    expect(dayLabel(at(2026, 9, 18), now)).toBe(new Date(2026, 9, 18).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
    expect(dayLabel(at(2025, 11, 30), now)).toBe(new Date(2025, 11, 30).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
    expect(dayLabel("not a date", now)).toBe("Unknown day");
  });
});

describe("project status", () => {
  type P = Parameters<typeof projectStatus>[0][number];
  const at = (h: number, m: number): string => new Date(2026, 9, 14, h, m).toISOString();
  const pt = (n: number, verdict: P["verdict"], time: string, note: string, prompt?: string): P => ({
    id: `cp-000${n}`, verdict, createdAt: time, note, trigger: prompt ? "claude-code:stop" : "app", agent: prompt ? { name: "Claude Code", prompt } : null,
  });
  const story = [pt(1, "PASS", at(18, 12), "Initial"), pt(2, "PASS", at(19, 3), "Added dark mode", "add dark mode"), pt(3, null, at(19, 40), "Changed currency"), pt(4, "FAIL", at(20, 16), "Added a dependency")];

  test("broken with a known working version: broken once, since the first failure, the way out named by its message with the time after it, see what changed", () => {
    const s = projectStatus(story);
    expect(s.head).toBe("Broken.");
    expect(s.voice).toBe(`Since “Added a dependency” (${when(at(20, 16))}).`);
    expect(s.body).toContain(`“Add dark mode” (${when(at(19, 3))}) still works.`);
    expect(s.primary).toEqual({ label: "Bring back “Add dark mode”", sub: when(at(19, 3)), act: "rewind-to", id: "cp-0002", title: `Bring back “Add dark mode” · ${when(at(19, 3))}` });
    expect(s.secondary).toEqual({ label: "See what changed", act: "compare", a: "cp-0002", b: "now" });
    expect(`${s.head} ${s.voice} ${s.body} ${s.primary.label}`).not.toContain("cp-");
  });

  test("broken since names the first failure after the last pass, not the newest", () => {
    const s = projectStatus([...story, pt(5, "FAIL", at(21, 0), "Later")]);
    expect(s.voice).toBe(`Since ${when(at(20, 16))}.`);
  });

  test("broken with nothing that works asks to find one", () => {
    const s = projectStatus([pt(1, null, at(9, 0), "a"), pt(2, "FAIL", at(10, 0), "b")]);
    expect(s.primary).toEqual({ label: "Find the last working version", act: "rewind" });
    expect(s.secondary).toBeNull();
  });

  test("works says when it was checked only when a check time is known", () => {
    const works = [pt(1, "PASS", at(20, 16), "a")];
    expect(projectStatus(works, at(20, 20))).toMatchObject({ head: "Works.", voice: `Checked at ${when(at(20, 20))}.` });
    expect(projectStatus(works)).toMatchObject({ head: "Works.", voice: `Saved “a” at ${when(at(20, 16))}.` });
    expect(projectStatus(works).primary.act).toBe("save");
    expect(projectStatus(works).secondary?.act).toBe("check");
  });

  test("the hero says the newest time once and never puts a space before punctuation", () => {
    // An untitled save point once read "7:33:18 AM , passed its check".
    const untitled = [pt(1, "PASS", at(20, 16), "")];
    for (const list of [untitled, story, [pt(1, null, at(9, 0), "")], [pt(1, "INCOMPLETE", at(9, 0), "")]]) {
      const s = projectStatus(list);
      const all = `${s.head} ${s.voice} ${s.body}`;
      expect(all).not.toMatch(/\s[,.;:]/);
      const newest = when(list.at(-1)!.createdAt);
      expect(all.split(newest).length - 1).toBeLessThanOrEqual(1);
    }
  });

  test("not checked yet is never shown as working, and its one step is Check it works", () => {
    const s = projectStatus([pt(1, null, at(9, 0), "a")]);
    expect(s.v).toBeNull();
    expect(s.head).toBe("Not checked yet.");
    expect(s.primary.act).toBe("check");
  });

  test("save points in the same minute carry seconds in the time beside their message", () => {
    const sec = (h: number, m: number, s: number): string => new Date(2026, 9, 14, h, m, s).toISOString();
    // The fixed date is not today, so times carry the day in front, like `when`.
    const withSeconds = (iso: string): string => `${new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    const sameMinute = [pt(1, "PASS", sec(18, 4, 5), "Works"), pt(2, "FAIL", sec(18, 4, 40), "Broke it")];
    const s = projectStatus(sameMinute);
    expect(s.voice).toBe(`Since “Broke it” (${withSeconds(sec(18, 4, 40))}).`);
    expect(s.primary.label).toBe("Bring back “Works”");
    expect(s.primary.sub).toBe(withSeconds(sec(18, 4, 5)));
    expect(s.primary.title).toBe(`Bring back “Works” · ${withSeconds(sec(18, 4, 5))}`);
  });

  test("twins in one second are told apart by their messages; with no message, by time and number (L364 #2)", () => {
    const sec = (d: Date, s: number): string => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 4, s).toISOString();
    const time = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const today = new Date();
    const t5 = time(sec(today, 5));
    const named = [pt(1, "PASS", sec(today, 5), "Works"), pt(2, "FAIL", sec(today, 5), "Broke it"), pt(3, null, sec(today, 30), "Later")];
    const s = projectStatus(named);
    expect(s.secondary).toMatchObject({ label: "Bring back “Works”", sub: t5 });
    expect(goBackLabel(named[1]!, named)).toBe(`Bring back “Broke it” · ${t5}`);
    expect(s.voice).toBe(`Saved “Later” at ${time(sec(today, 30))}.`);
    // No message: the time and the save point's number, never "the first save".
    const untitled = [pt(1, "PASS", sec(today, 5), ""), pt(2, "FAIL", sec(today, 5), "Auto save")];
    const broken = projectStatus(untitled);
    expect(broken.voice).toBe(`Since the save point at ${t5} #2.`);
    expect(broken.body).toContain(`The save point at ${t5} #1 still works.`);
    expect(broken.primary).toEqual({ label: `Bring back ${t5} #1`, act: "rewind-to", id: "cp-0001", title: `Bring back ${t5} #1` });
    expect(projectStatus([untitled[0]!, { ...untitled[1]!, verdict: null }]).voice).toBe(`Saved at ${t5} #2.`);
    expect(pointClock(untitled[0]!, untitled)).toBe(`${t5} #1`);
    // Another day: the day goes in front of the time.
    const day = new Date(2026, 9, 14);
    const old = [pt(1, "PASS", sec(day, 5), ""), pt(2, "FAIL", sec(day, 5), "")];
    const dayName = day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    expect(projectStatus(old).primary.label).toBe(`Bring back ${dayName} ${time(sec(day, 5))} #1`);
    // The name someone gave a save point wins over its message.
    const given = projectStatus(named.slice(0, 2), null, true, (c) => (c.id === "cp-0001" ? "Last green before refactor" : pointMessage(c)));
    expect(given.primary.label).toBe("Bring back “Last green before refactor”");
  });

  test("a message names a save point: given name, agent prompt, a written note, the commit subject; never a note the app wrote", () => {
    const base = { note: "", trigger: "app", agent: null };
    expect(pointMessage({ ...base, note: "Fixed the tip rounding" })).toBe("Fixed the tip rounding");
    expect(pointMessage({ ...base, note: "Saved by you" })).toBe("");
    expect(pointMessage({ ...base, note: "Auto save", trigger: "auto" })).toBe("");
    expect(pointMessage({ ...base, note: "npm run deploy", trigger: "claude-code:pre-bash", agent: { name: "Claude Code", prompt: "ship it" } })).toBe("");
    expect(pointMessage({ ...base, note: "After agent turn", trigger: "claude-code:stop", agent: { name: "Claude Code", prompt: "add dark mode" } })).toBe("Add dark mode");
    expect(pointMessage({ ...base, subject: "Tweak discount tier" })).toBe("Tweak discount tier");
    expect(pointMessage({ ...base, note: "Auto save" }, "Before the big refactor")).toBe("Before the big refactor");
    const long = namePoint({ id: "cp-0001", createdAt: new Date().toISOString() }, [], "A very long message that goes on and on past forty characters");
    expect(long.name.length).toBeLessThanOrEqual(42);
    expect(long.name.endsWith("…”")).toBe(true);
  });

  test("a home folder never shows: ~ in text and in a page's HTML, the real path kept where a button acts on it (L364 #3)", () => {
    expect(homePath("/Users/ana/tm-scratch/app")).toBe("~/tm-scratch/app");
    expect(homePath("Can’t find tips at /home/ana/tips.")).toBe("Can’t find tips at ~/tips.");
    expect(homePath("C:\\Users\\ana\\tips")).toBe("~\\tips");
    expect(homePath("/Users/Shared/tips")).toBe("/Users/Shared/tips");
    const html = `<span class="mono">/Users/ana/x</span><button data-act="reveal-dir" data-path="/Users/ana/x" title="/Users/ana/x">Show</button><input value="/Users/ana/typed"><pre>{&quot;dir&quot;: &quot;/Users/ana/x&quot;}</pre>`;
    const out = homeHtml(html);
    expect(out).toContain('<span class="mono">~/x</span>');
    expect(out).toContain('data-path="/Users/ana/x"');
    expect(out).toContain('title="~/x"');
    expect(out).toContain('value="/Users/ana/typed"');
    expect(out).toContain("&quot;~/x&quot;");
  });

  test("a save point names its agent once: dropped beside an author line, kept without one", () => {
    const stop = { note: "After agent turn", trigger: "claude-code:stop", agent: { name: "Claude Code", prompt: "add dark mode" } };
    expect(pointTitle(stop)).toBe("Claude Code: add dark mode");
    expect(pointTitle(stop, "Claude Code")).toBe("Add dark mode");
    expect(pointTitle(stop, "Agent")).toBe("Claude Code: add dark mode");
    const prompt = { ...stop, trigger: "claude-code:prompt" };
    expect(pointTitle(prompt)).toBe("Before Claude Code: add dark mode");
    expect(pointTitle(prompt, "Claude Code")).toBe("Before the prompt: add dark mode");
    expect(pointTitle({ ...stop, trigger: "claude-code:pre-bash", note: "Before risky command: rm -rf dist" }, "Safety save")).toBe("Before risky command: rm -rf dist");
    expect(pointTitle({ note: "Saved by you", trigger: "app", agent: null }, "You")).toBe("Saved by you");
  });

  test("N checks passed counts only the passes since the last check that did not pass", () => {
    const verify = (target: string, result: string) => ({ action: "verify", target, result });
    const streaks = passStreaks([
      verify("cp-0001", "PASS"), verify("cp-0001", "FAIL"), verify("cp-0001", "PASS"), verify("cp-0001", "PASS"),
      { action: "verify-stopped", target: "cp-0001", result: "INCOMPLETE" }, { action: "checkpoint", target: "cp-0002", result: "saved" },
      verify("cp-0002", "PASS"), verify("cp-0003", "PASS"), verify("cp-0003", "ERROR"),
    ]);
    expect(streaks.get("cp-0001")).toBe(2);
    expect(streaks.get("cp-0002")).toBe(1);
    expect(streaks.get("cp-0003")).toBe(0);
  });
});

describe("journal times", () => {
  test("a row's time stays whole on one line, and a same-second ordinal goes on a line of its own", () => {
    expect(clockParts("2:43:36 AM #3")).toEqual({ time: "2:43:36 AM", ord: "#3" });
    expect(clockParts("2:43 AM")).toEqual({ time: "2:43 AM", ord: "" });
    expect(clockParts("14:03:22")).toEqual({ time: "14:03:22", ord: "" });
  });
});

describe("jump to", () => {
  const items: PaletteItem[] = [
    { group: "Actions", label: "Save now", hint: "⌘S", act: "save" },
    { group: "Projects", label: "marigold-tips", hint: "Broken", act: "project", id: "p", verdict: "FAIL" },
    { group: "Save points", label: "7:03 PM · Claude Code: add dark mode", hint: "Works", act: "open", id: "cp-0003", verdict: "PASS" },
  ];

  test("every typed word must match, in any order, ignoring case", () => {
    expect(filterPalette(items, "DARK 7:03").map((i) => i.id)).toEqual(["cp-0003"]);
    expect(filterPalette(items, "works dark").map((i) => i.id)).toEqual(["cp-0003"]);
    expect(filterPalette(items, "dark broken")).toEqual([]);
  });

  test("an empty query keeps every item in order", () => {
    expect(filterPalette(items, "  ")).toEqual(items);
  });

  test("Reduce motion is one item away, and says whether it is on", () => {
    const off = reduceMotionItem(false);
    expect(filterPalette([...items, off], "motion")).toEqual([off]);
    expect(filterPalette([...items, off], "reduce")).toEqual([off]);
    expect(off).toMatchObject({ group: "Actions", label: "Reduce motion", hint: "Off", act: "reduce-motion" });
    expect(reduceMotionItem(true).hint).toBe("On");
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

describe("Claude Code hook command", () => {
  test("prefers the CLI the app can run itself, quoted; never npx while timetm is not published", () => {
    expect(NPM_PUBLISHED).toBe(false);
    const c = hookCandidates({ override: undefined, nodePath: "/usr/local/bin/node", cliScript: "/repo/packages/cli/dist/tm.js", version: "0.1.0" });
    expect(c).toEqual(["'/usr/local/bin/node' '/repo/packages/cli/dist/tm.js'"]);
    // Nobody owns the npm name yet, so a probe must never run npx: with no CLI of its own there is nothing to offer.
    expect(hookCandidates({ override: undefined, nodePath: "/x/node", cliScript: null, version: "0.1.0" })).toEqual([]);
    expect(hookCandidates({ override: "tm", nodePath: "/x/node", cliScript: "/repo/tm.js", version: "0.1.0" })).toEqual(["tm"]);
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
    state.projects.push({ id: projectId, path: dir, name: "acme", addedAt: "2026-10-15T00:00:00Z", demo: false, features: { ask: false, vercel: null, autoSave: "off" }, kind: "git", purpose: "code" });
    const noCipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };
    const offline = (): Promise<Response> => Promise.reject(new Error("no network in tests"));
    return { engine: new Engine(state, { candidates, version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch: offline }), projectId, dir };
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
