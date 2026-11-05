// find-good tells its caller each result as it lands (onResult), for the app's check run (B6 §3.2, Security on PR #75):
// one call per recorded result, in the engine's order, after the result is recorded, never for a stopped check; and a
// listener that throws (onResult or onTry) never ends the search early or loses its find-good audit line.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { setupDemo, type Demo } from "../../../fixtures/demo/setup.ts";

let shared: Demo;
beforeAll(async () => {
  shared = await setupDemo();
});

const lastAudit = async (ctx: tm.Ctx) => (await tm.log(ctx)).entries.at(-1);
/** The store's audit log's last line, read at once from inside a listener. */
const lastLine = (ctx: tm.Ctx): string => readFileSync(join(tm.storeDirFor(ctx), "audit.jsonl"), "utf8").trim().split("\n").at(-1) ?? "";

describe("find-good's onResult", () => {
  test("one call per tried save point, in order, with its recorded verdict, each after its verify audit line is written", async () => {
    const calls: { id: string; verdict: string; line: string }[] = [];
    const r = await tm.findGood(shared.ctx, { onResult: (id, verdict) => calls.push({ id, verdict, line: lastLine(shared.ctx) }) });
    expect(calls.map((c) => [c.id, c.verdict])).toEqual(r.tried.map((t) => [t.id, t.verdict]));
    expect(calls.map((c) => c.id)).toEqual(["cp-0006", "cp-0005", "cp-0004", "cp-0003"]);
    for (const c of calls) {
      expect(c.line).toContain('"verify"');
      expect(c.line).toContain(`"${c.id}"`);
    }
  });

  test("a stopped check is never reported", async () => {
    const { ctx } = await setupDemo();
    const stop = new AbortController();
    const results: string[] = [];
    const r = await tm.findGood(ctx, {
      signal: stop.signal,
      onTry: (id) => { if (id === "cp-0005") stop.abort(); },
      onResult: (id) => results.push(id),
    });
    expect(r.stopped).toBe(true);
    expect(results).toEqual(["cp-0006"]);
    expect(r.tried.map((t) => t.id)).toEqual(["cp-0006"]);
  });

  test("a listener that throws ends nothing: the same answer, and the find-good audit line is written", async () => {
    const { ctx } = await setupDemo();
    const r = await tm.findGood(ctx, {
      onResult: () => { throw new Error("listener broke"); },
      onTry: () => { throw new Error("listener broke too"); },
    });
    expect(r.found).toBe("cp-0003");
    expect(r.tried.map((t) => t.id)).toEqual(["cp-0006", "cp-0005", "cp-0004", "cp-0003"]);
    expect(await lastAudit(ctx)).toMatchObject({ action: "find-good", target: "cp-0003", result: "PASS" });
  });
});
