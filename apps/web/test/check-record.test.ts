// The window asks for a save point's stored check record by id only, uses it only when it is that save point's record
// with the verdict the timeline shows, and shows every field as text.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { VerdictRecord } from "@timetm/core";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { acceptRecord, checkBodyHtml } from "../src/renderer/check-record.ts";
import { Credentials, type Cipher } from "../src/server/credentials.ts";
import { Engine } from "../src/server/engine.ts";
import { AppState } from "../src/server/state.ts";
import { CallSchema } from "../src/shared/api.ts";

const noCipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

const record = (over: Partial<VerdictRecord> = {}): VerdictRecord => ({
  at: "2026-10-24T01:02:03.004Z", checkpoint: "cp-0005", verdict: "FAIL", isolation: "host", network: { policy: "allow", enforcedBy: null },
  command: "npm test", durationMs: 2310, exitCode: 1, reason: "The check failed with exit code 1.", log: "/store/logs/cp-0005-x.log", ...over,
});

describe("the call", () => {
  const projectId = randomUUID();
  test("takes a project and a save point id, nothing else", () => {
    expect(CallSchema.safeParse({ method: "checkRecord", projectId, id: "cp-0005" }).success).toBe(true);
    expect(CallSchema.safeParse({ method: "checkRecord", projectId, id: "cp-0005", log: "/etc/passwd" }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "checkRecord", projectId, id: "cp-0005/../x" }).success).toBe(false);
    expect(CallSchema.safeParse({ method: "checkRecord", projectId: "../x", id: "cp-0005" }).success).toBe(false);
  });

  test("serves only projects in the app's list", async () => {
    const dir = tempDir("checkrecord-engine");
    const engine = new Engine(new AppState(join(dir, "data")), { candidates: ["false"], version: "9.9.9" }, { credentials: new Credentials(join(dir, "credentials.json"), noCipher, {}), fetch });
    const r = await engine.run({ method: "checkRecord", projectId, id: "cp-0001" });
    expect(r).toEqual({ ok: false, error: { kind: "not_found", message: "That project is no longer in the list." } });
  });
});

describe("the renderer uses only a matching record", () => {
  const c = { id: "cp-0005", verdict: "FAIL" as const };
  test("this save point's record with the timeline's verdict is used", () => {
    expect(acceptRecord({ ok: true, data: record() }, c)).toEqual(record());
  });

  test("another verdict, another save point, none, or an error is not", () => {
    expect(acceptRecord({ ok: true, data: record({ verdict: "PASS", exitCode: 0 }) }, c)).toBeNull();
    expect(acceptRecord({ ok: true, data: record({ checkpoint: "cp-0004" }) }, c)).toBeNull();
    expect(acceptRecord({ ok: true, data: record() }, { id: "cp-0005", verdict: null })).toBeNull();
    expect(acceptRecord({ ok: true, data: null }, c)).toBeNull();
    expect(acceptRecord({ ok: false, error: { kind: "not_found", message: "That save point's check record couldn't be read." } }, c)).toBeNull();
  });
});

describe("T8 the record on screen", () => {
  // The children of the reason's element: any tag inside it would be one.
  const reasonOf = (html: string): string => /<div class="cw-r">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";

  test("markup in the reason, the command or the log is text, never an element", () => {
    const html = checkBodyHtml(record({ reason: "Missing saved files: <img src=x onerror=alert(1)>", command: "<script>alert(2)</script>" }), true, true);
    expect(reasonOf(html)).toBe("Missing saved files: &lt;img src=x onerror=alert(1)&gt;");
    expect(reasonOf(html)).not.toMatch(/<[a-z!/]/i);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  test("the reason is clipped to 300 code points", () => {
    const shown = reasonOf(checkBodyHtml(record({ reason: "é".repeat(1000) }), true, true));
    expect(Array.from(shown)).toHaveLength(300);
    expect(shown.endsWith("...")).toBe(true);
    expect(reasonOf(checkBodyHtml(record({ reason: "short" }), true, true))).toBe("short");
  });

  test("the command, the exit code and the network show; a check that never ran shows no exit line", () => {
    const html = checkBodyHtml(record({ network: { policy: "deny", enforcedBy: "sandbox-exec" } }), true, true);
    expect(html).toContain("npm test");
    expect(html).toContain("exit code 1 · network off");
    expect(checkBodyHtml(record({ exitCode: null, log: null }), false, true)).not.toContain("network");
  });
});
