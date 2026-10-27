// Auto save while the app is open: a change saves once the folder is quiet, bursts give one save,
// ignored paths and "off" never save, and the engine starts and stops watches with the project list.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as tm from "@timetm/core";
import { write } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { AutoSaver, ignoredPath, type AutoSaveProject, type WatchFn } from "../src/server/autosave.ts";
import { Credentials, type Cipher } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";
import type { AppEvent, ProjectStatus } from "../src/shared/api.ts";

const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

/** A watcher the test drives: `emit` reports a change in a watched project. */
function fakeWatch(): { watch: WatchFn; emit: (root: string, rel: string | null) => void; open: () => string[] } {
  const live = new Map<string, (rel: string | null) => void>();
  return {
    watch: (root, onChange) => {
      live.set(root, onChange);
      return { close: () => live.delete(root) };
    },
    emit: (root, rel) => live.get(root)?.(rel),
    open: () => [...live.keys()],
  };
}

const project = (autoSave: AutoSaveProject["autoSave"] = "change"): AutoSaveProject => ({ id: "p1", path: "/Users/you/Documents/thesis", autoSave });

describe("AutoSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function saver(over: { busy?: () => boolean } = {}) {
    const w = fakeWatch();
    const saves: string[] = [];
    const reasons: string[] = [];
    const s = new AutoSaver({ watch: w.watch, busy: over.busy ?? (() => false), save: async (id, reason) => { saves.push(id); reasons.push(reason); }, ignoreDirs: ["/Users/you/.timemachine"] });
    return { s, w, saves, reasons };
  }

  test("while changes keep coming, a save still happens at least every 2 minutes", async () => {
    const { s, w, saves } = saver();
    s.sync([project()]);
    // A change every 10 s for 5 minutes: never 20 s of quiet.
    const at: number[] = [];
    for (let t = 0; t < 300_000; t += 10_000) {
      w.emit("/Users/you/Documents/thesis", "chapter-4.md");
      const before = saves.length;
      await vi.advanceTimersByTimeAsync(10_000);
      if (saves.length > before) at.push(t + 10_000);
    }
    expect(at).toEqual([120_000, 240_000]);
    // Once the writing stops, the last changes save after the usual quiet.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toHaveLength(3);
  });

  test("catchUp makes one start save of each watched project within 10 s, then changes save as usual", async () => {
    const { s, w, saves, reasons } = saver();
    s.sync([project(), { id: "p2", path: "/Users/you/Documents/notes", autoSave: "off" }]);
    s.catchUp();
    w.emit("/Users/you/Documents/thesis", "a.md");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saves).toEqual(["p1"]);
    expect(reasons).toEqual(["start"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(saves).toEqual(["p1"]);
    w.emit("/Users/you/Documents/thesis", "b.md");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reasons).toEqual(["start", "change"]);
  });

  test("a change saves exactly once, after 20 s of quiet", async () => {
    const { s, w, saves } = saver();
    s.sync([project()]);
    w.emit("/Users/you/Documents/thesis", "chapters/01.md");
    await vi.advanceTimersByTimeAsync(19_000);
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saves).toEqual(["p1"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(saves).toEqual(["p1"]);
  });

  test("a burst of changes gives one save, 20 s after the last one", async () => {
    const { s, w, saves } = saver();
    s.sync([project()]);
    for (let i = 0; i < 10; i++) {
      w.emit("/Users/you/Documents/thesis", `notes/${i}.md`);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(saves).toEqual(["p1"]);
  });

  test("at most one save a minute, and none while the project is busy", async () => {
    let busy = false;
    const { s, w, saves } = saver({ busy: () => busy });
    s.sync([project()]);
    w.emit("/Users/you/Documents/thesis", "a.md");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toHaveLength(1);
    w.emit("/Users/you/Documents/thesis", "b.md");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toHaveLength(1);
    busy = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saves).toHaveLength(1);
    busy = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toHaveLength(2);
  });

  test("Git, installed dependencies, the store and editor temp files never trigger a save", async () => {
    const { s, w, saves } = saver();
    s.sync([project()]);
    for (const rel of [".git/index", "node_modules/x/index.js", ".DS_Store", "docs/.DS_Store", "Thumbs.db", "docs/desktop.ini", "~$thesis.docx", "notes.md.swp", ".#notes.md", "/Users/you/.timemachine/projects/x/audit.jsonl"]) {
      w.emit("/Users/you/Documents/thesis", rel);
    }
    await vi.advanceTimersByTimeAsync(120_000);
    expect(saves).toEqual([]);
    expect(ignoredPath("chapters/01.md")).toBe(false);
  });

  test('"off" never watches or saves, and turning it off or removing the project stops the watch', async () => {
    const { s, w, saves } = saver();
    s.sync([project("off")]);
    expect(w.open()).toEqual([]);
    w.emit("/Users/you/Documents/thesis", "a.md");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(saves).toEqual([]);
    s.sync([project("change")]);
    expect(s.watching()).toEqual(["p1"]);
    w.emit("/Users/you/Documents/thesis", "a.md");
    s.sync([project("off")]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(saves).toEqual([]);
    expect(w.open()).toEqual([]);
  });

  test("without a recursive watch it polls once a minute", async () => {
    const saves: string[] = [];
    const s = new AutoSaver({ watch: () => { throw new Error("ERR_FEATURE_UNAVAILABLE_ON_PLATFORM"); }, busy: () => false, save: async (id) => saves.push(id) });
    s.sync([project()]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saves).toEqual(["p1"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saves).toEqual(["p1", "p1"]);
    s.close();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(saves).toHaveLength(2);
  });
});

describe("Engine auto save", () => {
  test("new document folders save on change; git projects and \"off\" do not; the watch follows setFeature and removeProject", async () => {
    const dir = tempDir("autosave");
    const folder = join(dir, "thesis");
    write(folder, "intro.md", "First draft.\n");
    const before = process.env.TM_HOME;
    process.env.TM_HOME = join(dir, "store");
    const engine = new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, {
      credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch,
      autoSave: { quietMs: 300, minGapMs: 0 },
    });
    try {
      const added = await engine.addProject(folder);
      expect(added.features.autoSave).toBe("change");
      expect(engine.autoSaver.watching()).toEqual([added.id]);
      await engine.run({ method: "checkpoint", projectId: added.id, note: "First" });

      // A real change, seen by the real watcher, becomes one "Auto save" save point. Real time on purpose:
      // the system's file events arrive on their own schedule, so this waits for the save point itself.
      writeFileSync(join(folder, "intro.md"), "Second draft.\n");
      const ctx = { cwd: folder, env: process.env };
      const deadline = Date.now() + 15_000;
      let t = await tm.timeline(ctx);
      while (t.checkpoints.length < 2 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        t = await tm.timeline(ctx);
      }
      expect(t.checkpoints.map((c) => [c.note, c.trigger])).toEqual([["First", "app"], ["Auto save", "auto"]]);

      expect(await engine.run({ method: "setFeature", projectId: added.id, change: { feature: "autoSave", autoSave: "off" } })).toMatchObject({ ok: true, data: { features: { autoSave: "off" } } });
      expect(engine.autoSaver.watching()).toEqual([]);
      expect(new AppState(join(dir, "data")).find(added.id)?.features.autoSave).toBe("off");
      await engine.run({ method: "setFeature", projectId: added.id, change: { feature: "autoSave", autoSave: "change" } });
      expect(engine.autoSaver.watching()).toEqual([added.id]);
      await engine.run({ method: "removeProject", projectId: added.id });
      expect(engine.autoSaver.watching()).toEqual([]);

      // A code folder (purpose code) starts with auto save off.
      const code = join(dir, "scripts");
      write(code, "run.sh", "echo hi\n");
      expect((await engine.addProject(code, false, "code")).features.autoSave).toBe("off");
      expect(engine.autoSaver.watching()).toEqual([]);
    } finally {
      engine.close();
      if (before === undefined) delete process.env.TM_HOME;
      else process.env.TM_HOME = before;
    }
  });

  test("a failing auto save becomes the project's problem, with one autosave-failed audit entry, until a save works again", async () => {
    const dir = tempDir("autosave-fail");
    const folder = join(dir, "thesis");
    write(folder, "intro.md", "First draft.\n");
    const before = process.env.TM_HOME;
    process.env.TM_HOME = join(dir, "store");
    const w = fakeWatch();
    vi.useFakeTimers();
    const engine = new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, {
      credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch,
      autoSave: { quietMs: 1000, minGapMs: 0, watch: w.watch },
    });
    const problem = async (): Promise<string | null | undefined> => {
      const s = await engine.run({ method: "statuses" });
      // engine.run answers every method with one union type; statuses always returns ProjectStatus[].
      return s.ok ? (s.data as ProjectStatus[])[0]?.problem : `statuses failed: ${s.error.message}`;
    };
    try {
      const added = await engine.addProject(folder);
      await engine.run({ method: "checkpoint", projectId: added.id, note: "First" });
      // The folder's settings in the store are broken, so every save fails until they are fixed.
      const settings = join(tm.storeDirFor({ cwd: folder, env: process.env }), "timemachine.yml");
      writeFileSync(settings, "capture: [oops\n");
      const edit = async (text: string): Promise<void> => {
        writeFileSync(join(folder, "intro.md"), text);
        w.emit(added.path, "intro.md");
        await vi.advanceTimersByTimeAsync(1000);
      };

      await edit("Second draft.\n");
      await vi.waitFor(async () => expect(await problem()).toMatch(/^Auto save failed: timemachine\.yml is not valid YAML/));
      await edit("Third draft.\n");
      await vi.waitFor(() => expect(engine.busy.has(added.id)).toBe(false));
      const log = await engine.run({ method: "log", projectId: added.id });
      expect(log.ok && (log.data as tm.LogResult).entries.filter((e) => e.action === "autosave-failed")).toHaveLength(1);
      expect(engine.autoSaver.watching()).toEqual([added.id]);

      rmSync(settings);
      await edit("Fourth draft.\n");
      await vi.waitFor(async () => expect(await problem()).toBe(null));
      expect((await tm.timeline({ cwd: folder, env: process.env })).checkpoints.map((c) => c.note)).toEqual(["First", "Auto save"]);
    } finally {
      engine.close();
      vi.useRealTimers();
      if (before === undefined) delete process.env.TM_HOME;
      else process.env.TM_HOME = before;
    }
  });

  test("on start, a folder edited while the app was closed gets one catch-up save, and the saved event names what was left out", async () => {
    const dir = tempDir("autosave-catchup");
    const folder = join(dir, "thesis");
    write(folder, "intro.md", "First draft.\n");
    const before = process.env.TM_HOME;
    process.env.TM_HOME = join(dir, "store");
    const make = (): Engine => new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, {
      credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch,
      autoSave: { watch: fakeWatch().watch, catchUpMs: 50 },
    });
    const first = make();
    let second: Engine | undefined;
    try {
      const added = await first.addProject(folder);
      await first.run({ method: "checkpoint", projectId: added.id, note: "First" });
      first.close();

      // While the app is closed: an edit, and a recording over the size limit.
      writeFileSync(join(folder, "intro.md"), "Second draft.\n");
      writeFileSync(join(folder, "interview.wav"), Buffer.alloc(6 * 1024 * 1024));
      second = make();
      const events: AppEvent[] = [];
      second.onEvent((e) => events.push(e));
      await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 10_000 });
      expect(events[0]).toMatchObject({ type: "saved", projectId: added.id, trigger: "app", checkpoint: "cp-0002" });
      expect(events[0]?.type === "saved" && events[0].skipped).toEqual([expect.stringMatching(/^interview\.wav: over the 5 MB limit/)]);
      const t = await tm.timeline({ cwd: folder, env: process.env });
      expect(t.checkpoints.map((c) => [c.note, c.trigger])).toEqual([["First", "app"], ["Saved when the app started", "app"]]);

      // Nothing changed since: the next start makes no save point. A Save now queues behind the catch-up save
      // and is skipped as well, so after it nothing can still be running.
      second.close();
      vi.useFakeTimers();
      second = make();
      await vi.advanceTimersByTimeAsync(50);
      vi.useRealTimers();
      expect(await second.run({ method: "checkpoint", projectId: added.id, ifChanged: true })).toMatchObject({ ok: true, data: { skipped: true } });
      expect((await tm.timeline({ cwd: folder, env: process.env })).checkpoints).toHaveLength(2);
    } finally {
      first.close();
      second?.close();
      if (before === undefined) delete process.env.TM_HOME;
      else process.env.TM_HOME = before;
    }
  });
});
