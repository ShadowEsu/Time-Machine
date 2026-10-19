// Adding a project the app is not allowed to read.
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
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
