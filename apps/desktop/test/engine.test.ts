// Adding a project the app is not allowed to read, and adding one with no test command.
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { status } from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { Credentials, type Cipher } from "../src/main/credentials.ts";
import { Engine } from "../src/main/engine.ts";
import { AppState } from "../src/main/state.ts";

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
    expect(status(ctx)).toEqual({ initialized: true, approved: false, check: null });
    expect(await engine.run({ method: "checkpoint", projectId, note: "First save point", ifChanged: true })).toMatchObject({ ok: true, data: { checkpoint: { id: "cp-0001" } } });
    expect(await engine.run({ method: "setCheck", projectId, command: "node -e 0" })).toMatchObject({ ok: true, data: { verifyCommand: "node -e 0" } });
    expect(status(ctx)).toEqual({ initialized: true, approved: true, check: "node -e 0" });
    expect(await engine.run({ method: "verify", projectId, id: "cp-0001" })).toMatchObject({ ok: true, data: { verdict: "PASS" } });
  } finally {
    if (before === undefined) delete process.env.TM_HOME;
    else process.env.TM_HOME = before;
  }
});
