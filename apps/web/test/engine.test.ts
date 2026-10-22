// Adding a project the app is not allowed to read, adding one with no test command, and the free project limit.
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { signLicense, status } from "@timetm/core";
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
