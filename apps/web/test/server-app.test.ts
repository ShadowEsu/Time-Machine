// The local app server: the project list survives two writers, one app per store, the Add flow's
// paths, projects the CLI set up, the store size, the folder chooser and Finder, and a read-only store.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { Credentials, type Cipher } from "../src/server/credentials.ts";
import { Engine, type ExecFn, type Services } from "../src/server/engine.ts";
import { acquireServerLock, AppState } from "../src/server/state.ts";
import { CallSchema, type ProjectEntry, type ProjectStatus, type StorageResult, type StoreProject } from "../src/shared/api.ts";

const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };
// Root writes anywhere, and Windows has no Unix permission bits.
const canLock = process.platform !== "win32" && process.getuid?.() !== 0;

let dir = "";
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  dir = tempDir("server-app");
  for (const k of ["TM_HOME", "HOME"]) saved[k] = process.env[k];
  process.env.TM_HOME = join(dir, "store");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function engine(over: Partial<Services> = {}, data = join(dir, "data")): Engine {
  return new Engine(new AppState(data), { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch, ...over });
}

const entry = (id: string, path: string): ProjectEntry => ({
  id, path, name: path.split("/").at(-1) ?? "x", addedAt: "2026-10-25T00:00:00Z", demo: false, features: { ask: false, vercel: null, autoSave: "off" }, kind: "folder", purpose: "documents",
});

describe("the project list", () => {
  test("a write re-reads projects.json first, so two windows never undo each other's changes", () => {
    const data = join(dir, "data");
    const a = new AppState(data);
    const b = new AppState(data);
    const one = entry("0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a11", "/Users/you/one");
    const two = entry("0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a12", "/Users/you/two");
    a.updateProjects((list) => [...list, one]);
    // B read the file before A added one; its write must keep A's project.
    b.updateProjects((list) => [...list, two]);
    expect(new AppState(data).projects.map((p) => p.id)).toEqual([one.id, two.id]);
    a.updateProjects((list) => list.filter((p) => p.id !== two.id));
    expect(b.reload().map((p) => p.id)).toEqual([one.id]);
    expect(b.updateProject(two.id, (p) => ({ ...p, purpose: "code" }))).toBe(null);
    expect(b.updateProject(one.id, (p) => ({ ...p, purpose: "research" }))?.purpose).toBe("research");
    expect(new AppState(data).find(one.id)?.purpose).toBe("research");
    // Each write goes through its own temp file and a rename: none is left behind.
    expect(readdirSync(data).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("settings writes keep a change another window made", () => {
    const data = join(dir, "data");
    const a = new AppState(data);
    const b = new AppState(data);
    a.updateSettings({ theme: "dark" });
    b.updateSettings({ showGitDetails: true });
    expect(new AppState(data).settings).toMatchObject({ theme: "dark", showGitDetails: true });
  });
});

describe("one app per store", () => {
  test("a second start is refused with the running app's address, while that process lives", () => {
    const ui = join(dir, "ui");
    mkdirSync(ui, { recursive: true });
    // The parent of this test process is alive, so its lock counts.
    writeFileSync(join(ui, "server.lock"), JSON.stringify({ pid: process.ppid, port: 4563 }));
    let refused: unknown;
    try {
      acquireServerLock(ui);
    } catch (e) {
      refused = e;
    }
    expect(refused).toMatchObject({ kind: "usage", message: `Time Machine is already running for this store at http://127.0.0.1:4563. Open that, or stop it first. If it isn't running, delete ${join(ui, "server.lock")}.` });
    // tm ui exits with the usage code.
    expect(refused instanceof tm.TmError && refused.exitCode).toBe(64);
    expect(JSON.parse(readFileSync(join(ui, "server.lock"), "utf8"))).toEqual({ pid: process.ppid, port: 4563 });
  });

  test("a lock left by an app that ended is taken over, records the port, and is removed on release", () => {
    const ui = join(dir, "ui");
    mkdirSync(ui, { recursive: true });
    const ended = spawnSync(process.execPath, ["-e", "0"]).pid;
    writeFileSync(join(ui, "server.lock"), JSON.stringify({ pid: ended, port: 4563 }));
    const lock = acquireServerLock(ui);
    expect(JSON.parse(readFileSync(join(ui, "server.lock"), "utf8"))).toMatchObject({ pid: process.pid, port: null });
    lock.setPort(4570);
    expect(JSON.parse(readFileSync(join(ui, "server.lock"), "utf8"))).toMatchObject({ pid: process.pid, port: 4570 });
    lock.release();
    expect(existsSync(join(ui, "server.lock"))).toBe(false);
  });

  test("this process's own lock counts as held, and a port is never written into a lock another process took (Security F2)", () => {
    const ui = join(dir, "ui");
    mkdirSync(ui, { recursive: true });
    writeFileSync(join(ui, "server.lock"), JSON.stringify({ pid: process.pid, port: 4563 }));
    expect(() => acquireServerLock(ui)).toThrow("Time Machine is already running for this store at http://127.0.0.1:4563.");
    rmSync(join(ui, "server.lock"));
    const lock = acquireServerLock(ui);
    // Another start took the store over (this one looked dead to it): the port and the release leave its lock alone.
    writeFileSync(join(ui, "server.lock"), JSON.stringify({ pid: process.ppid, port: 4564 }));
    expect(lock.setPort(4570)).toBe(false);
    lock.release();
    expect(JSON.parse(readFileSync(join(ui, "server.lock"), "utf8"))).toEqual({ pid: process.ppid, port: 4564 });
  });

  /** A lock as this process writes it (with this computer's boot ID where the system has one), held by `pid`. */
  function lockOf(ui: string, pid: number): Record<string, unknown> {
    const lock = acquireServerLock(ui);
    const mine = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(join(ui, "server.lock"), "utf8")));
    lock.release();
    return { ...mine, pid, port: 4563 };
  }

  test.skipIf(process.platform !== "darwin" && process.platform !== "linux")("a lock from an earlier start of the computer is taken over, even when its process number is in use again; one from this start stays held whatever its file's time says (Security F13, R2)", () => {
    const ui = join(dir, "ui");
    mkdirSync(ui, { recursive: true });
    const path = join(ui, "server.lock");
    const live = lockOf(ui, process.ppid);
    expect(live.boot).toEqual(expect.any(String));
    // A clock step forward makes a live lock's file look older than the boot: it is still held.
    writeFileSync(path, JSON.stringify(live));
    const beforeBoot = new Date(Date.now() - uptime() * 1000 - 3_600_000);
    utimesSync(path, beforeBoot, beforeBoot);
    expect(() => acquireServerLock(ui)).toThrow("Time Machine is already running for this store at http://127.0.0.1:4563.");
    writeFileSync(path, JSON.stringify({ ...live, boot: "an-earlier-boot" }));
    acquireServerLock(ui).release();
    expect(existsSync(path)).toBe(false);
  });

  test("a lock with no boot ID is dated by its file: one from before the computer started is taken over, even with a pid in use again (Security R2)", () => {
    const ui = join(dir, "ui");
    mkdirSync(ui, { recursive: true });
    const path = join(ui, "server.lock");
    writeFileSync(path, JSON.stringify({ pid: process.ppid, port: 4563 }));
    const beforeBoot = new Date(Date.now() - uptime() * 1000 - 3_600_000);
    utimesSync(path, beforeBoot, beforeBoot);
    const lock = acquireServerLock(ui);
    // Every lock carries its own nonce, so a takeover never mistakes two locks for one (R4).
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: process.pid, nonce: expect.any(String) });
    lock.release();
  });

  test("a takeover waits for one another live start is making, and clears one a start that ended left (Security R1)", () => {
    const ui = join(dir, "ui");
    mkdirSync(ui, { recursive: true });
    const path = join(ui, "server.lock");
    const ended = spawnSync(process.execPath, ["-e", "0"]).pid;
    writeFileSync(path, JSON.stringify({ pid: ended, port: 4563 }));
    writeFileSync(join(ui, "server.lock.takeover"), JSON.stringify({ pid: process.ppid, port: null }));
    expect(() => acquireServerLock(ui)).toThrow("Another Time Machine is starting for this store. Try again in a moment.");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ pid: ended, port: 4563 });
    writeFileSync(join(ui, "server.lock.takeover"), JSON.stringify({ pid: ended, port: null }));
    const lock = acquireServerLock(ui);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: process.pid });
    expect(existsSync(join(ui, "server.lock.takeover"))).toBe(false);
    lock.release();
  });
});

describe("adding a folder", () => {
  test("empty, relative, a file and ~ paths answer in plain words; ~ means the home folder", async () => {
    process.env.HOME = join(dir, "home");
    write(join(dir, "home", "Thesis"), "chapter-1.md", "Once.\n");
    write(join(dir, "home"), "notes.txt", "x\n");
    const e = engine();
    expect(await e.run({ method: "addProject", path: "  " })).toEqual({ ok: false, error: { kind: "usage", message: "Enter a folder path." } });
    expect(await e.run({ method: "addProject", path: "Thesis" })).toMatchObject({ ok: false, error: { kind: "usage", message: "Enter the whole path to the folder, starting with / or ~/." } });
    expect(await e.run({ method: "addProject", path: "~/notes.txt" })).toEqual({ ok: false, error: { kind: "usage", message: "That is a file, not a folder." } });
    expect(await e.run({ method: "addProject", path: "~/Nope" })).toEqual({ ok: false, error: { kind: "usage", message: "That folder does not exist." } });
    const r = await e.run({ method: "addProject", path: "~/Thesis/", purpose: "documents" });
    expect(r).toMatchObject({ ok: true, data: { path: realpathSync(join(dir, "home", "Thesis")), kind: "folder", existingSavePoints: 0, scripts: [] } });
  });

  test("a folder the CLI set up is listed under storeProjects until it is added, and adding it keeps its history", async () => {
    const folder = join(dir, "big");
    write(folder, "a.md", "one\n");
    const ctx = { cwd: folder, env: process.env };
    tm.protect(ctx);
    await tm.checkpoint(ctx, { note: "From the CLI" });
    write(folder, "a.md", "two\n");
    await tm.checkpoint(ctx, { note: "Again" });
    const e = engine();
    const listed = await e.run({ method: "storeProjects" });
    expect(listed.ok && (listed.data as StoreProject[])).toEqual([
      expect.objectContaining({ path: realpathSync(folder), name: "big", kind: "folder", savePoints: 2, exists: true }),
    ]);
    expect(await e.run({ method: "previewProject", path: folder })).toMatchObject({ ok: true, data: { path: realpathSync(folder), existingSavePoints: 2 } });
    const added = await e.run({ method: "addProject", path: folder });
    expect(added).toMatchObject({ ok: true, data: { existingSavePoints: 2 } });
    expect((await tm.timeline(ctx)).checkpoints.map((c) => c.note)).toEqual(["From the CLI", "Again"]);
    expect(await e.run({ method: "storeProjects" })).toEqual({ ok: true, data: [] });
  });

  test("the call schema takes empty, ~ and absolute paths, and refuses a relative one", () => {
    const ok = (path: string): boolean => CallSchema.safeParse({ method: "addProject", path }).success;
    for (const path of ["", "  ", "~", "~/Thesis", "/Users/you/Thesis"]) expect(ok(path)).toBe(true);
    for (const path of ["relative", "Thesis/notes", "~you/Thesis"]) expect(ok(path)).toBe(false);
    expect(CallSchema.safeParse({ method: "relinkProject", projectId: "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a11", path: "relative" }).success).toBe(false);
  });

  test("the preview offers only scripts that exist, and the check setup would pick, writing nothing", async () => {
    const project = join(dir, "shop");
    write(project, "package.json", JSON.stringify({ name: "shop", scripts: { test: "node --test", lint: "eslint ." } }));
    git(dir, "init", "-q", "-b", "main", project);
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", "first");
    const e = engine();
    expect(await e.run({ method: "previewProject", path: project })).toMatchObject({ ok: true, data: { kind: "git", scripts: ["test", "lint"], existingSavePoints: 0, check: { command: "npm test", setup: "", exists: false } } });
    expect(existsSync(join(project, "timemachine.yml"))).toBe(false);
    expect(existsSync(join(dir, "store"))).toBe(false);
    // A project with its own settings keeps them.
    write(project, "timemachine.yml", "version: 1\nverify:\n  command: node -e 0\n  setup: npm ci\n  network: allow\n");
    expect(await e.run({ method: "previewProject", path: project })).toMatchObject({ ok: true, data: { check: { command: "node -e 0", setup: "npm ci", network: "allow", exists: true } } });
    // A plain folder starts with no check.
    const notes = join(dir, "notes");
    write(notes, "a.md", "one\n");
    expect(await e.run({ method: "previewProject", path: notes })).toMatchObject({ ok: true, data: { kind: "folder", check: { command: "", setup: "", exists: false } } });
  });
});

describe("storage", () => {
  test("counts the whole store, removed projects too, and says what lives in a code project's .git", async () => {
    const folder = join(dir, "notes");
    write(folder, "a.md", "one\n");
    const project = join(dir, "shop");
    write(project, "index.js", "1;\n");
    git(dir, "init", "-q", "-b", "main", project);
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", "first");
    const e = engine();
    const notes = await e.addProject(folder);
    await e.run({ method: "checkpoint", projectId: notes.id, note: "First" });
    const first = (await e.run({ method: "storage" })) as { ok: true; data: StorageResult };
    expect(first.data.note).toBe(null);
    expect(first.data.storeBytes).toBeGreaterThanOrEqual(first.data.rows[0]?.bytes ?? 0);
    expect(first.data.rows[0]?.bytes).toBeGreaterThan(0);
    await e.addProject(project);
    await e.run({ method: "removeProject", projectId: notes.id });
    const after = (await e.run({ method: "storage" })) as { ok: true; data: StorageResult };
    expect(after.data.storeBytes).toBeGreaterThanOrEqual(first.data.storeBytes);
    expect(after.data.note).toBe("Code projects (shop) also keep their save points inside the project's own .git folder. That space is not counted here.");
  });
});

describe("the folder chooser and Finder", () => {
  function fakeExec(answer: { code: number | null; stdout: string }): { exec: ExecFn; calls: [string, string[], number][] } {
    const calls: [string, string[], number][] = [];
    return { calls, exec: async (file, args, timeoutMs) => { calls.push([file, args, timeoutMs]); return answer; } };
  }

  test("pickFolder runs the Mac chooser for 2 minutes at most, and answers null on cancel", async () => {
    const chose = fakeExec({ code: 0, stdout: "/Users/you/Documents/Thesis/\n" });
    expect(await engine({ exec: chose.exec, platform: "darwin" }).run({ method: "pickFolder" })).toEqual({ ok: true, data: { path: "/Users/you/Documents/Thesis" } });
    expect(chose.calls).toEqual([["osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose a folder to protect")'], 120_000]]);
    const cancelled = fakeExec({ code: 1, stdout: "" });
    expect(await engine({ exec: cancelled.exec, platform: "darwin" }).run({ method: "pickFolder" })).toEqual({ ok: true, data: { path: null } });
    const linux = fakeExec({ code: 0, stdout: "/x\n" });
    expect(await engine({ exec: linux.exec, platform: "linux" }).run({ method: "pickFolder" })).toMatchObject({ ok: false, error: { kind: "usage" } });
    expect(linux.calls).toEqual([]);
  });

  test("reveal opens Finder only on paths in the home or temp folder", async () => {
    const f = fakeExec({ code: 0, stdout: "" });
    const e = engine({ exec: f.exec, platform: "darwin" });
    const file = join(dir, "report.md");
    writeFileSync(file, "x\n");
    expect(await e.run({ method: "reveal", path: file })).toEqual({ ok: true, data: true });
    expect(f.calls).toEqual([["open", ["-R", realpathSync(file)], 10_000]]);
    expect(await e.run({ method: "reveal", path: "/etc/hosts" })).toMatchObject({ ok: false, error: { kind: "usage" } });
    expect(await e.run({ method: "reveal", path: join(dir, "gone.md") })).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(f.calls).toHaveLength(1);
  });
});

describe("a store this user can't write", () => {
  test.runIf(canLock)("calls fail with kind permission and name the store; the project is not called missing", async () => {
    const folder = join(dir, "p1");
    write(folder, "a.md", "one\n");
    const e = engine();
    const p = await e.addProject(folder);
    await e.run({ method: "checkpoint", projectId: p.id, note: "First" });
    write(folder, "a.md", "two\n");
    const store = join(dir, "store");
    spawnSync("chmod", ["-R", "a-w", store]);
    try {
      const r = await e.run({ method: "checkpoint", projectId: p.id, note: "Second" });
      const sentence = `Time Machine can't write to its store at ${store}. Check the folder's permissions.`;
      expect(r).toEqual({ ok: false, error: { kind: "permission", message: sentence } });
      const s = await e.run({ method: "statuses" });
      expect(s.ok && (s.data as ProjectStatus[])[0]).toMatchObject({ problem: sentence, problemKind: "permission", newest: { id: "cp-0001" } });
    } finally {
      spawnSync("chmod", ["-R", "u+w", store]);
    }
  });

  test("a missing folder is the only one called missing", async () => {
    const folder = join(dir, "gone");
    write(folder, "a.md", "one\n");
    const e = engine();
    const p = await e.addProject(folder);
    rmSync(folder, { recursive: true, force: true });
    const s = await e.run({ method: "statuses" });
    expect(s.ok && (s.data as ProjectStatus[])[0]).toMatchObject({ problemKind: "missing", problem: `We can't find gone at ${p.path}. Its history is safe in the store.` });
  });
});

describe("a moved folder", () => {
  test("its history still reads and can be copied out; relinkProject points it at the new folder, keeping its history", async () => {
    const folder = join(dir, "Thesis");
    write(folder, "chapter-1.md", "Once.\n");
    const e = engine();
    const p = await e.addProject(folder);
    await e.run({ method: "checkpoint", projectId: p.id, note: "First" });
    const moved = join(dir, "Thesis-moved");
    renameSync(folder, moved);

    expect(await e.run({ method: "timeline", projectId: p.id })).toMatchObject({ ok: true, data: { checkpoints: [{ id: "cp-0001", note: "First" }] } });
    expect(await e.run({ method: "checkpoint", projectId: p.id })).toMatchObject({ ok: false, error: { kind: "not_found" } });
    const s = await e.run({ method: "statuses" });
    expect(s.ok && (s.data as ProjectStatus[])[0]).toMatchObject({ problemKind: "missing", newest: { id: "cp-0001" } });
    const dest = join(dir, "Recovered");
    mkdirSync(dest);
    const copy = await e.run({ method: "recover", projectId: p.id, id: "cp-0001", dest });
    expect(copy.ok).toBe(true);
    const copyDir = copy.ok && copy.data !== null && typeof copy.data === "object" && "copyDir" in copy.data && typeof copy.data.copyDir === "string" ? copy.data.copyDir : "";
    expect(readFileSync(join(copyDir, "chapter-1.md"), "utf8")).toBe("Once.\n");

    expect(await e.run({ method: "relinkProject", projectId: p.id, path: join(dir, "nowhere") })).toEqual({ ok: false, error: { kind: "usage", message: "That folder does not exist." } });
    const r = await e.run({ method: "relinkProject", projectId: p.id, path: moved });
    expect(r).toMatchObject({ ok: true, data: { id: p.id, path: realpathSync(moved), name: "Thesis-moved", kind: "folder" } });
    expect(new AppState(join(dir, "data")).find(p.id)?.path).toBe(realpathSync(moved));
    const after = await e.run({ method: "statuses" });
    expect(after.ok && (after.data as ProjectStatus[])[0]).toMatchObject({ problem: null, problemKind: null, newest: { id: "cp-0001" } });
    write(moved, "chapter-2.md", "Twice.\n");
    expect(await e.run({ method: "checkpoint", projectId: p.id, note: "After the move" })).toMatchObject({ ok: true, data: { checkpoint: { id: "cp-0002" } } });
  });
});

describe("putting one file back", () => {
  test("restorePaths writes the saved file into the live folder after a save of what was there, and a stray path is refused", async () => {
    const folder = join(dir, "Thesis");
    write(folder, "chapter-1.md", "Once.\n");
    write(folder, "chapter-2.md", "Twice.\n");
    const e = engine();
    const p = await e.addProject(folder);
    await e.run({ method: "checkpoint", projectId: p.id, note: "First" });
    write(folder, "chapter-1.md", "GARBAGE\n");
    const r = await e.run({ method: "restorePaths", projectId: p.id, id: "cp-0001", paths: ["chapter-1.md"] });
    expect(r).toMatchObject({ ok: true, data: { restored: ["chapter-1.md"], skipped: [], savedBefore: "cp-0002" } });
    expect(readFileSync(join(folder, "chapter-1.md"), "utf8")).toBe("Once.\n");
    expect(await e.run({ method: "timeline", projectId: p.id })).toMatchObject({ ok: true, data: { checkpoints: [{ id: "cp-0001" }, { id: "cp-0002", trigger: "before-restore" }] } });
    expect(CallSchema.safeParse({ method: "restorePaths", projectId: p.id, id: "cp-0001", paths: [] }).success).toBe(false);
    const stray = await e.run({ method: "restorePaths", projectId: p.id, id: "cp-0001", paths: ["../outside.md"] });
    expect(stray).toMatchObject({ ok: true, data: { restored: [], skipped: [expect.stringContaining("../outside.md")] } });
    expect(existsSync(join(dir, "outside.md"))).toBe(false);
  });
});

describe("backing out of the Add flow", () => {
  const repo = (name: string): string => {
    const root = join(dir, name);
    write(root, "index.js", "console.log(1)\n");
    git(root, "init", "-q", "-b", "main");
    git(root, "add", ".");
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    return root;
  };

  test("removing with dropSettings takes out the timemachine.yml this app created, and never one that was already there", async () => {
    const e = engine();
    const fresh = repo("fresh");
    const p = await e.addProject(fresh);
    expect(await e.run({ method: "init", projectId: p.id })).toMatchObject({ ok: true, data: { created: true } });
    expect(existsSync(join(fresh, "timemachine.yml"))).toBe(true);
    expect((await e.run({ method: "removeProject", projectId: p.id, dropSettings: true })).ok).toBe(true);
    expect(existsSync(join(fresh, "timemachine.yml"))).toBe(false);

    const own = repo("own");
    writeFileSync(join(own, "timemachine.yml"), "version: 1\nverify:\n  command: \"npm test\"\n");
    const q = await e.addProject(own);
    expect(await e.run({ method: "init", projectId: q.id })).toMatchObject({ ok: true, data: { created: false } });
    await e.run({ method: "removeProject", projectId: q.id, dropSettings: true });
    expect(readFileSync(join(own, "timemachine.yml"), "utf8")).toContain("npm test");
  });

  test("a created file the app itself changed still goes; one someone else edited, or another tab added again, stays", async () => {
    const e = engine();
    const ours = repo("ours");
    const p = await e.addProject(ours);
    await e.run({ method: "init", projectId: p.id });
    expect((await e.run({ method: "setCheck", projectId: p.id, command: "npm test" })).ok).toBe(true);
    await e.run({ method: "removeProject", projectId: p.id, dropSettings: true });
    expect(existsSync(join(ours, "timemachine.yml"))).toBe(false);

    const edited = repo("edited");
    const q = await e.addProject(edited);
    await e.run({ method: "init", projectId: q.id });
    writeFileSync(join(edited, "timemachine.yml"), `${readFileSync(join(edited, "timemachine.yml"), "utf8")}# mine\n`);
    await e.run({ method: "removeProject", projectId: q.id, dropSettings: true });
    expect(readFileSync(join(edited, "timemachine.yml"), "utf8")).toContain("# mine");

    const twice = repo("twice");
    const r = await e.addProject(twice);
    await e.run({ method: "init", projectId: r.id });
    await e.addProject(twice);
    await e.run({ method: "removeProject", projectId: r.id, dropSettings: true });
    expect(existsSync(join(twice, "timemachine.yml"))).toBe(true);
  });

  test("a check saved in Settings re-marks the file; an edit made before the app's own write makes it the user's", async () => {
    const e = engine();
    const viaSettings = repo("via-settings");
    const p = await e.addProject(viaSettings);
    await e.run({ method: "init", projectId: p.id });
    expect((await e.run({ method: "setProjectConfig", projectId: p.id, patch: { command: "npm test" } })).ok).toBe(true);
    await e.run({ method: "removeProject", projectId: p.id, dropSettings: true });
    expect(existsSync(join(viaSettings, "timemachine.yml"))).toBe(false);

    const theirs = repo("theirs");
    const q = await e.addProject(theirs);
    await e.run({ method: "init", projectId: q.id });
    writeFileSync(join(theirs, "timemachine.yml"), `${readFileSync(join(theirs, "timemachine.yml"), "utf8")}# mine\n`);
    await e.run({ method: "setCheck", projectId: q.id, command: "npm test" });
    await e.run({ method: "removeProject", projectId: q.id, dropSettings: true });
    expect(existsSync(join(theirs, "timemachine.yml"))).toBe(true);
  });

  test("an edit that lands right after the app's own write makes the file the user's, so Back keeps it", async () => {
    const e = engine();
    const root = repo("after-write");
    const p = await e.addProject(root);
    await e.run({ method: "init", projectId: p.id });
    const yml = join(root, "timemachine.yml");
    const before = readFileSync(yml, "utf8");
    const appText = `${before}# app\n`;
    const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
    await e["ownWrite"](p.id, () => {
      writeFileSync(yml, appText);
      writeFileSync(yml, `${appText}# mine\n`);
      return { read: sha(before), written: sha(appText) };
    });
    await e.run({ method: "removeProject", projectId: p.id, dropSettings: true });
    expect(existsSync(yml)).toBe(true);
  });

  test("an edit that lands just before the app reads the file is merged into its write, and the file becomes the user's", async () => {
    const e = engine();
    const root = repo("before-read");
    const p = await e.addProject(root);
    await e.run({ method: "init", projectId: p.id });
    const yml = join(root, "timemachine.yml");
    const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
    await e["ownWrite"](p.id, () => {
      const theirs = `${readFileSync(yml, "utf8")}# mine\n`;
      writeFileSync(yml, theirs);
      const appText = `${theirs}# app\n`;
      writeFileSync(yml, appText);
      return { read: sha(theirs), written: sha(appText) };
    });
    await e.run({ method: "removeProject", projectId: p.id, dropSettings: true });
    expect(existsSync(yml)).toBe(true);
  });

  test("a settings call that writes nothing keeps the file the app made", async () => {
    const e = engine();
    const root = repo("no-write");
    const p = await e.addProject(root);
    await e.run({ method: "init", projectId: p.id });
    await e["ownWrite"](p.id, () => ({}));
    await e.run({ method: "removeProject", projectId: p.id, dropSettings: true });
    expect(existsSync(join(root, "timemachine.yml"))).toBe(false);
  });

  test("setProjectConfig with ifCommand writes nothing once the command is no longer that one, or the file is gone", async () => {
    const e = engine();
    const root = repo("cas");
    const p = await e.addProject(root);
    await e.run({ method: "init", projectId: p.id });
    await e.run({ method: "setProjectConfig", projectId: p.id, patch: { command: "npm test" } });
    const yml = join(root, "timemachine.yml");
    const before = readFileSync(yml, "utf8");
    expect(await e.run({ method: "setProjectConfig", projectId: p.id, patch: { command: "" }, ifCommand: "pnpm test" })).toMatchObject({ ok: false, error: { message: tm.CHECK_CHANGED_MEANWHILE } });
    expect(readFileSync(yml, "utf8")).toBe(before);
    expect(await e.run({ method: "setProjectConfig", projectId: p.id, patch: { command: "" }, ifCommand: "npm test" })).toMatchObject({ ok: true, data: { command: "" } });
    rmSync(yml);
    expect(await e.run({ method: "setProjectConfig", projectId: p.id, patch: { command: "npm test" }, ifCommand: "" })).toMatchObject({ ok: false, error: { message: "timemachine.yml is no longer there, so nothing was changed." } });
    expect(existsSync(yml)).toBe(false);
  });
});

describe("check settings", () => {
  test("read and change the check, its setup, timeout, network and size limit; a folder's settings stay in the store", async () => {
    const folder = join(dir, "notes");
    write(folder, "a.md", "one\n");
    const e = engine();
    const p = await e.addProject(folder);
    expect(await e.run({ method: "projectConfig", projectId: p.id })).toEqual({ ok: true, data: { command: "", setup: "", timeoutSeconds: 600, network: "allow", maxFileMB: 5 } });
    const set = await e.run({ method: "setProjectConfig", projectId: p.id, patch: { maxFileMB: 50, timeoutSeconds: 120, network: "deny" } });
    expect(set).toEqual({ ok: true, data: { command: "", setup: "", timeoutSeconds: 120, network: "deny", maxFileMB: 50 } });
    expect(await e.run({ method: "projectConfig", projectId: p.id })).toMatchObject({ ok: true, data: { maxFileMB: 50 } });
    expect(existsSync(join(folder, "timemachine.yml"))).toBe(false);
    // A file over the old 5 MB limit is saved now.
    writeFileSync(join(folder, "interview.wav"), Buffer.alloc(6 * 1024 * 1024));
    const saved = await e.run({ method: "checkpoint", projectId: p.id, note: "With the recording" });
    const data = saved.ok ? saved.data : null;
    const missing = data !== null && typeof data === "object" && "checkpoint" in data && typeof data.checkpoint === "object" && data.checkpoint !== null && "coverage" in data.checkpoint
      && typeof data.checkpoint.coverage === "object" && data.checkpoint.coverage !== null && "missing" in data.checkpoint.coverage ? data.checkpoint.coverage.missing : "no save";
    expect(missing).toEqual([]);
  });

  test("the patch is checked before it reaches the engine", () => {
    const projectId = "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a11";
    const ok = (patch: unknown): boolean => CallSchema.safeParse({ method: "setProjectConfig", projectId, patch }).success;
    expect(ok({ command: "npm test", setup: "npm ci" })).toBe(true);
    expect(ok({ command: "" })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ command: "npm test\nrm -rf ~" })).toBe(false);
    expect(ok({ maxFileMB: 0 })).toBe(false);
    expect(ok({ timeoutSeconds: 1.5 })).toBe(false);
    expect(ok({ network: "maybe" })).toBe(false);
    expect(ok({ other: 1 })).toBe(false);
  });
});
