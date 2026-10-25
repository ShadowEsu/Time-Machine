// The window asks for the end of a check's log by save point id only, and shows its lines as text.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { tailHtml } from "../src/renderer/log-tail.ts";
import { Credentials, type Cipher } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";
import { CallSchema } from "../src/shared/api.ts";

const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

describe("T10 the call", () => {
  const projectId = randomUUID();
  test("takes a project and a save point id, nothing else", () => {
    expect(CallSchema.safeParse({ method: "checkLogTail", projectId, id: "cp-0012" }).success).toBe(true);
    expect(CallSchema.safeParse({ method: "checkLogTail", projectId, id: "cp-0012", path: "/etc/passwd" }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "checkLogTail", projectId, id: "cp-0012/../x" }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "checkLogTail", projectId, id: "../../.ssh/id_rsa" }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "checkLogTail", projectId: "../x", id: "cp-0012" }).success).toBe(false);
  });

  test("serves only projects in the app's list", async () => {
    const dir = tempDir("logtail-engine");
    const engine = new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch });
    const r = await engine.run({ method: "checkLogTail", projectId, id: "cp-0001" });
    expect(r).toEqual({ ok: false, error: { kind: "not_found", message: "That project is no longer in the list." } });
  });
});

describe("T11 the lines on screen", () => {
  const log = "/store/logs/cp-0012-2026-10-24T01-02-03-004Z.log";
  const done = (lines: string[]) => ({ state: "done" as const, tail: { log, lines, binary: false, hidden: false } });

  test("markup in a line is text, never an element or an attribute", () => {
    const html = tailHtml(log, done(["<img src=x onerror=alert(1)>", '" onmouseover="alert(2)']));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // The copy button carries the same lines in an attribute, quotes escaped.
    expect(html).not.toContain('" onmouseover="');
    expect(html).toContain("&quot; onmouseover=&quot;alert(2)");
  });

  test("a newer run's log never shows for an older verdict, and hidden or binary ends show no lines", () => {
    expect(tailHtml("/store/logs/cp-0012-older.log", done(["from the newer run"]))).toBe("");
    expect(tailHtml(log, { state: "done", tail: { log, lines: [], binary: true, hidden: false } })).not.toContain("<pre");
    expect(tailHtml(log, { state: "done", tail: { log, lines: [], binary: false, hidden: true } })).not.toContain("<pre");
    expect(tailHtml(log, { state: "done", tail: null })).toBe("");
  });
});
