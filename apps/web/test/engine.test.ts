// Adding a project the app is not allowed to read, adding one with no test command, and the free project limit.
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { signLicense, status, type RecoverResult } from "@timetm/core";
import type { ProjectEntry, SourceRow } from "../src/shared/api.ts";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { Credentials, type Cipher } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";

const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };
// Root reads any folder, and Windows has no Unix permission bits.
const canLock = process.platform !== "win32" && process.getuid?.() !== 0;

test.runIf(canLock)("a folder the app can't read says so, instead of calling it not a Git repository", async () => {
  const dir = tempDir("unreadable");
  const locked = join(dir, "project");
  mkdirSync(locked);
  const state = new AppState(join(dir, "data"));
  const engine = new Engine(state, { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch });
  chmodSync(locked, 0o000);
  try {
    const r = await engine.run({ method: "addProject", path: locked });
    expect(r).toMatchObject({ ok: false, error: { kind: "usage" } });
    expect(!r.ok && r.error.message).toContain(`can't read ${locked}`);
    expect(new AppState(join(dir, "data")).projects).toEqual([]);
  } finally {
    chmodSync(locked, 0o755);
  }
});

test("a project with no test command: setup approves nothing, the first save point works, and the check typed in the wizard is approved", async () => {
  const dir = tempDir("notest");
  const project = join(dir, "app");
  write(project, "package.json", JSON.stringify({ name: "app", scripts: { start: "node index.js" } }));
  write(project, "index.js", "1;\n");
  git(dir, "init", "-q", "-b", "main", project);
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "first");
  // The engine reads TM_HOME from the process, like the app.
  const before = process.env.TM_HOME;
  process.env.TM_HOME = join(dir, "store");
  try {
    const engine = new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch });
    const projectId = (await engine.addProject(project)).id;
    const ctx = { cwd: project, env: process.env };
    // The wizard's step 2 shows the "No test command found" state for an empty verifyCommand.
    expect(await engine.run({ method: "init", projectId })).toMatchObject({ ok: true, data: { created: true, verifyCommand: "", approvedCheck: null } });
    expect(status(ctx)).toMatchObject({ initialized: true, approved: false, check: null, kind: "git" });
    expect(await engine.run({ method: "checkpoint", projectId, note: "First save point", ifChanged: true })).toMatchObject({ ok: true, data: { checkpoint: { id: "cp-0001" } } });
    expect(await engine.run({ method: "setCheck", projectId, command: "node -e 0" })).toMatchObject({ ok: true, data: { verifyCommand: "node -e 0" } });
    expect(status(ctx)).toMatchObject({ initialized: true, approved: true, check: "node -e 0" });
    expect(await engine.run({ method: "verify", projectId, id: "cp-0001" })).toMatchObject({ ok: true, data: { verdict: "PASS" } });
  } finally {
    if (before === undefined) delete process.env.TM_HOME;
    else process.env.TM_HOME = before;
  }
});

test("the free app lists three projects: a fourth is refused until a key is saved in Settings, and removing the key stops a fifth", async () => {
  const dir = tempDir("freelimit");
  const paths = [1, 2, 3, 4, 5].map((n) => {
    const p = join(dir, `p${n}`);
    write(p, "a.txt", `${n}\n`);
    git(dir, "init", "-q", "-b", "main", p);
    git(p, "add", "-A");
    git(p, "commit", "-q", "-m", "first");
    return p;
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
  const priv = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url");
  const before = process.env.TM_HOME;
  process.env.TM_HOME = join(dir, "store");
  try {
    const engine = new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch, licensePublicKey: pub });
    for (const path of paths.slice(0, 3)) expect((await engine.run({ method: "addProject", path })).ok).toBe(true);
    expect(await engine.run({ method: "addProject", path: paths[3]! })).toMatchObject({ ok: false, error: { kind: "usage" } });
    expect(await engine.run({ method: "setLicense", key: signLicense({ v: 1, id: "cs_test_freelimit", plan: "web", issued: "2026-10-22" }, priv) })).toMatchObject({ ok: true, data: { active: true } });
    expect((await engine.run({ method: "addProject", path: paths[3]! })).ok).toBe(true);
    expect(await engine.run({ method: "removeLicense" })).toMatchObject({ ok: true, data: { active: false } });
    expect(await engine.run({ method: "addProject", path: paths[4]! })).toMatchObject({ ok: false, error: { kind: "usage" } });
    expect(new AppState(join(dir, "data")).projects).toHaveLength(4);
  } finally {
    if (before === undefined) delete process.env.TM_HOME;
    else process.env.TM_HOME = before;
  }
});

/** Runs `fn` with TM_HOME pointed at a store in `dir`: the engine reads it from the process, like the app. */
async function withStore(dir: string, fn: () => Promise<void>): Promise<void> {
  const before = process.env.TM_HOME;
  process.env.TM_HOME = join(dir, "store");
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.TM_HOME;
    else process.env.TM_HOME = before;
  }
}

function newEngine(dir: string): Engine {
  return new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch });
}

/** Every entry in a folder with its bytes and modification time. */
function listing(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).sort().map((rel) => {
    const st = lstatSync(join(dir, rel));
    return `${rel} ${st.isFile() ? readFileSync(join(dir, rel), "utf8") : "dir"} ${st.mtimeMs}`;
  });
}

test("a plain folder is added as a documents folder, saved, recovered to a copy only, and never written", async () => {
  const dir = tempDir("enginefolder");
  const folder = join(dir, "thesis-notes");
  write(folder, "chapters/01-intro.md", "First draft.\n");
  write(folder, "references.bib", "@book{a}\n");
  await withStore(dir, async () => {
    const engine = newEngine(dir);
    const before = listing(folder);
    const added = await engine.run({ method: "addProject", path: folder });
    if (!added.ok) throw new Error(added.error.message);
    const entry = added.data as ProjectEntry;
    expect(entry).toMatchObject({ kind: "folder", purpose: "documents", name: "thesis-notes" });
    const projectId = entry.id;
    // Adding it again finds the same project.
    expect(await engine.run({ method: "addProject", path: folder })).toMatchObject({ ok: true, data: { id: projectId } });

    expect(await engine.run({ method: "checkpoint", projectId, note: "First draft" })).toMatchObject({ ok: true, data: { checkpoint: { id: "cp-0001" } } });
    expect(listing(folder)).toEqual(before);
    write(folder, "chapters/01-intro.md", "Rewritten.\n");
    const changed = listing(folder);
    expect(await engine.run({ method: "checkpoint", projectId, note: "Rewrite" })).toMatchObject({ ok: true, data: { checkpoint: { id: "cp-0002" } } });
    expect(await engine.run({ method: "verify", projectId, id: "cp-0001" })).toMatchObject({ ok: true, data: { verdict: "BLOCKED" } });

    const r = await engine.run({ method: "recover", projectId, id: "cp-0001" });
    if (!r.ok) throw new Error(r.error.message);
    const rec = r.data as RecoverResult;
    expect(rec).toMatchObject({ copyOnly: true, branch: "" });
    expect(readFileSync(join(rec.copyDir, "chapters/01-intro.md"), "utf8")).toBe("First draft.\n");
    expect(listing(folder)).toEqual(changed);
    expect(existsSync(join(folder, ".git"))).toBe(false);
    expect(await engine.run({ method: "hookInstall", projectId })).toMatchObject({ ok: false });
    expect(await engine.run({ method: "undoRecover", projectId, id: "cp-0001", branch: "", copyDir: rec.copyDir })).toMatchObject({ ok: true, data: { removedCopy: rec.copyDir } });
    expect(listing(folder)).toEqual(changed);

    expect(new AppState(join(dir, "data")).projects).toMatchObject([{ id: projectId, kind: "folder", purpose: "documents" }]);
  });
});

test("purpose: chosen when adding, changed with setPurpose, kept on disk, and code for projects saved before purposes", async () => {
  const dir = tempDir("purpose");
  const project = join(dir, "trial-run-analysis");
  write(project, "analysis.py", "print(1)\n");
  git(dir, "init", "-q", "-b", "main", project);
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "first");
  await withStore(dir, async () => {
    const engine = newEngine(dir);
    const added = await engine.run({ method: "addProject", path: project, purpose: "research" });
    if (!added.ok) throw new Error(added.error.message);
    const entry = added.data as ProjectEntry;
    expect(entry).toMatchObject({ kind: "git", purpose: "research" });
    const projectId = entry.id;
    expect(await engine.run({ method: "setPurpose", projectId, purpose: "agents" })).toMatchObject({ ok: true, data: { id: projectId, purpose: "agents" } });
    expect(new AppState(join(dir, "data")).projects).toMatchObject([{ id: projectId, kind: "git", purpose: "agents" }]);
    expect(await engine.run({ method: "setPurpose", projectId: "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a10", purpose: "code" })).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });

  // A projects file from before kinds and purposes loads as Git code projects.
  const old = join(dir, "old");
  write(old, "projects.json", JSON.stringify({ version: 1, projects: [{ id: "0b8f2f5e-3f7c-4a59-9a43-1d2f6c1b2a10", path: project, name: "trial-run-analysis", addedAt: "2026-10-15T00:00:00Z", demo: false }] }));
  expect(new AppState(old).projects).toMatchObject([{ kind: "git", purpose: "code" }]);
});

test("run notes: pin and name a save point through the engine; long or secret text is refused", async () => {
  const dir = tempDir("enginenotes");
  const folder = join(dir, "trial-runs");
  write(folder, "run-01.csv", "a,b\n1,2\n");
  await withStore(dir, async () => {
    const engine = newEngine(dir);
    const projectId = (await engine.addProject(folder, false, "research")).id;
    expect(await engine.run({ method: "checkpoint", projectId, note: "Run 01" })).toMatchObject({ ok: true });
    expect(await engine.run({ method: "notes", projectId })).toEqual({ ok: true, data: {} });
    expect(await engine.run({ method: "setNote", projectId, id: "cp-0001", title: "Baseline, seed 42", pinned: true })).toMatchObject({ ok: true, data: { title: "Baseline, seed 42", pinned: true } });
    expect(await engine.run({ method: "notes", projectId })).toMatchObject({ ok: true, data: { "cp-0001": { title: "Baseline, seed 42", pinned: true } } });
    expect(await engine.run({ method: "setNote", projectId, id: "cp-0001", note: "DB_PASSWORD=hunter2-correct-horse" })).toMatchObject({ ok: false, error: { kind: "usage" } });
    expect(await engine.run({ method: "setNote", projectId, id: "cp-0009", title: "x" })).toMatchObject({ ok: false, error: { kind: "usage" } });
    expect(listing(folder)).toEqual([`run-01.csv a,b\n1,2\n ${lstatSync(join(folder, "run-01.csv")).mtimeMs}`]);
  });
});

test("thinning through the engine: a fresh project has nothing to thin, and an id that is not in the preview is refused", async () => {
  const dir = tempDir("enginethin");
  const folder = join(dir, "notes");
  write(folder, "a.md", "1\n");
  await withStore(dir, async () => {
    const engine = newEngine(dir);
    const projectId = (await engine.addProject(folder)).id;
    expect(await engine.run({ method: "checkpoint", projectId, note: "First" })).toMatchObject({ ok: true });
    expect(await engine.run({ method: "thinPreview", projectId })).toMatchObject({ ok: true, data: { remove: [], keep: 1 } });
    expect(await engine.run({ method: "thinApply", projectId, ids: ["cp-0001"] })).toMatchObject({ ok: false, error: { kind: "usage", message: expect.stringMatching(/can't be thinned/) } });
    expect(await engine.run({ method: "thinApply", projectId, ids: [] })).toEqual({ ok: true, data: { removed: 0 } });
    expect(await engine.run({ method: "timeline", projectId })).toMatchObject({ ok: true, data: { checkpoints: [{ id: "cp-0001" }] } });
    engine.close();
  });
});

test("sources: reports well-known folders under HOME by checking they exist", async () => {
  const dir = tempDir("enginesources");
  const home = join(dir, "home");
  mkdirSync(join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"), { recursive: true });
  mkdirSync(join(home, "Documents"), { recursive: true });
  const before = process.env.HOME;
  process.env.HOME = home;
  try {
    const r = await newEngine(dir).run({ method: "sources" });
    expect(r).toMatchObject({ ok: true });
    const found = r.ok ? (r.data as SourceRow[]).filter((s) => s.found).map((s) => s.id) : [];
    expect(found).toEqual(["icloud", "documents"]);
  } finally {
    if (before === undefined) delete process.env.HOME;
    else process.env.HOME = before;
  }
});
