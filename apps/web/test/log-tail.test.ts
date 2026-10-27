// The window asks for the end of a check's log by save point id only, and shows its lines as text.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { tempDir } from "../../../fixtures/demo/setup.ts";
import { failingLine, failingTests, tailHtml } from "../src/renderer/log-tail.ts";
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

  test("while the end is read it says so, so a slow read never looks like a check that printed nothing", () => {
    expect(tailHtml(log, { state: "loading" })).toContain("Reading the end of what it printed");
    expect(tailHtml(log, undefined)).toContain("Reading the end of what it printed");
  });

  test("the failing tests' names lead the block", () => {
    const html = tailHtml(log, done(["✖ failing tests:", "", "✖ price multiplies (3.68ms)", "  AssertionError: 301 !== 300"]));
    expect(html).toContain("Failing: price multiplies");
    expect(html.indexOf("Failing:")).toBeLessThan(html.indexOf("<pre"));
  });
});

describe("failing test names", () => {
  test("node's test runner, TAP, Jest and Vitest", () => {
    expect(failingTests(["✔ price adds (0.4ms)", "✖ price multiplies (3.689416ms)", "✖ failing tests:", "✖ price multiplies (3.689416ms)"])).toEqual(["price multiplies"]);
    expect(failingTests(["ok 1 - adds", "not ok 2 - multiplies", "not ok 3 rounds # TODO"])).toEqual(["multiplies", "rounds"]);
    expect(failingTests(["PASS src/a.test.js", "FAIL src/price.test.js", " FAIL  src/b.test.ts > rounds"])).toEqual(["src/price.test.js", "src/b.test.ts > rounds"]);
    expect(failingTests(["  ● price › multiplies", "  ● Console"])).toEqual(["price › multiplies"]);
    expect(failingTests(["all good", "exit code 1"])).toEqual([]);
  });

  test("the line names at most three, then how many more", () => {
    expect(failingLine([])).toBe("");
    expect(failingLine(["a"])).toBe("Failing: a");
    expect(failingLine(["a", "b", "c", "d", "e"])).toBe("Failing: a, b, c and 2 more");
  });
});
