// The stored check record of one save point, read back for the app: only sealed records whose manifest still holds,
// only the asked id's (and only its manifest is read), the newest one, with the command and the reason cleaned of
// today's .env values and anything that looks like a key. Records are written the way verify writes them.
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import * as tm from "@timetm/core";
import { resolveProject, type Project } from "../src/project.ts";
import * as store from "../src/store.ts";
import { recordVerdict } from "../src/verdicts.ts";
import { setupDemo, type Demo } from "../../../fixtures/demo/setup.ts";

// Every manifest read, by checkpoint id, so the test can prove only the asked id's manifest is read.
const reads = vi.hoisted(() => ({ manifests: [] as string[] }));
vi.mock("../src/store.ts", async (importOriginal) => {
  const real = await importOriginal<typeof store>();
  return {
    ...real,
    readManifest: (p: Project, id: string) => {
      reads.manifests.push(id);
      return real.readManifest(p, id);
    },
  };
});

const HIDDEN_COMMAND = "(command hidden: it looked like it contained a secret)";
const HIDDEN_REASON = "(reason hidden: it looked like it contained a secret)";

let demo: Demo;
let p: Project;
let verdicts: string;

beforeAll(async () => {
  demo = await setupDemo();
  p = resolveProject(demo.ctx);
  verdicts = join(tm.storeDirFor(demo.ctx), "verdicts.jsonl");
});

beforeEach(() => {
  rmSync(verdicts, { force: true, recursive: true });
  writeFileSync(join(demo.dir, ".env"), "PORT=3000\n");
  reads.manifests = [];
});

function rec(id: string, over: Partial<tm.VerdictRecord> = {}): tm.VerdictRecord {
  return {
    at: "2026-10-24T01:02:03.004Z", checkpoint: id, verdict: "FAIL", isolation: "host", network: { policy: "allow", enforcedBy: null },
    command: "node --test", durationMs: 1200, exitCode: 1, reason: "The check failed with exit code 1.", log: `/store/logs/${id}-x.log`, ...over,
  };
}

/** A genuine record: sealed and bound to the save point's real manifest, as verify stores it. */
function genuine(r: tm.VerdictRecord): void {
  recordVerdict(p, r, store.readManifest(p, r.checkpoint).integrity);
  reads.manifests = [];
}

test("bad ids are refused", () => {
  for (const id of ["cp-12", "cp-0012/../x", "../verdicts", "cp-0003 ", "CP-0003"]) {
    expect(() => tm.checkRecord(demo.ctx, id)).toThrow(new tm.TmError("usage", "That is not a save point id."));
  }
});

test("a save point with no record has none", () => {
  expect(tm.checkRecord(demo.ctx, "cp-0003")).toBeNull();
  genuine(rec("cp-0004"));
  expect(tm.checkRecord(demo.ctx, "cp-0003")).toBeNull();
});

test("a real check's record comes back as verify returned it", async () => {
  const v = await tm.verify(demo.ctx, "cp-0003");
  const { stopped: _stopped, ...record } = v;
  expect(tm.checkRecord(demo.ctx, "cp-0003")).toEqual(record);
});

describe("only sealed records", () => {
  test("a forged line is ignored: changed after sealing, unsigned, or not a record", () => {
    genuine(rec("cp-0003", { reason: "the real one" }));
    const real = store.readJsonl(verdicts)[0] as { record: tm.VerdictRecord; manifest: string; seal: string };
    const later = "2026-10-25T00:00:00.000Z";
    appendFileSync(verdicts, `${JSON.stringify({ ...real, record: { ...real.record, at: later, verdict: "PASS", reason: "forged" } })}\n`);
    appendFileSync(verdicts, `${JSON.stringify({ record: { ...real.record, at: later, reason: "unsigned" }, manifest: real.manifest })}\n`);
    appendFileSync(verdicts, `${JSON.stringify({ ...real, seal: "0".repeat(64), record: { ...real.record, reason: "bad seal" } })}\n`);
    appendFileSync(verdicts, "{not json\n");
    expect(tm.checkRecord(demo.ctx, "cp-0003")?.reason).toBe("the real one");
  });

  test("a stale line, sealed for another manifest, is ignored", () => {
    const body = { record: rec("cp-0003", { reason: "stale" }), manifest: "sha256-of-an-older-manifest" };
    appendFileSync(verdicts, `${JSON.stringify({ ...body, seal: store.sign(p, body) })}\n`);
    expect(tm.checkRecord(demo.ctx, "cp-0003")).toBeNull();
    genuine(rec("cp-0003", { reason: "current" }));
    appendFileSync(verdicts, `${JSON.stringify({ ...body, seal: store.sign(p, body) })}\n`);
    expect(tm.checkRecord(demo.ctx, "cp-0003")?.reason).toBe("current");
  });

  test("the newest valid record wins", () => {
    genuine(rec("cp-0003", { at: "2026-10-24T01:00:00.000Z", verdict: "PASS", exitCode: 0, reason: "older" }));
    genuine(rec("cp-0003", { at: "2026-10-24T02:00:00.000Z", reason: "newest" }));
    genuine(rec("cp-0004", { at: "2026-10-24T03:00:00.000Z", reason: "another save point" }));
    expect(tm.checkRecord(demo.ctx, "cp-0003")).toEqual(rec("cp-0003", { at: "2026-10-24T02:00:00.000Z", reason: "newest" }));
  });
});

describe("only the asked id", () => {
  test("T6 a record for another id in the same file is never returned", () => {
    genuine(rec("cp-0004", { reason: "for cp-0004" }));
    expect(tm.checkRecord(demo.ctx, "cp-0003")).toBeNull();
    genuine(rec("cp-0003", { reason: "for cp-0003" }));
    genuine(rec("cp-0005", { reason: "for cp-0005, newer" }));
    expect(tm.checkRecord(demo.ctx, "cp-0003")?.checkpoint).toBe("cp-0003");
    expect(tm.checkRecord(demo.ctx, "cp-0003")?.reason).toBe("for cp-0003");
  });

  test("only the asked id's manifest is read", () => {
    for (const id of ["cp-0001", "cp-0002", "cp-0004", "cp-0005", "cp-0006", "cp-0003"]) genuine(rec(id));
    expect(tm.checkRecord(demo.ctx, "cp-0003")?.checkpoint).toBe("cp-0003");
    expect(new Set(reads.manifests)).toEqual(new Set(["cp-0003"]));
  });
});

describe("T7 the command and the reason are cleaned", () => {
  test("a value in today's .env comes back redacted", () => {
    genuine(rec("cp-0003", { command: "node --test --seed=Wq7pLm2xRt9", reason: "The check failed after Wq7pLm2xRt9 ran." }));
    // Added to .env after the record was written.
    writeFileSync(join(demo.dir, ".env"), "PORT=3000\nPAYMENTS_PASSCODE=Wq7pLm2xRt9\n");
    const r = tm.checkRecord(demo.ctx, "cp-0003");
    expect(r?.command).toBe("node --test --seed=[redacted]");
    expect(r?.reason).toBe("The check failed after [redacted] ran.");
  });

  test("a value that looks like a key hides the whole command or reason", () => {
    // Joined at run time: a literal would trip GitHub's push protection, which blocks the branch from being pushed.
    const key = ["sk", "live", "Ab3dE6gH9jK2mN5pQ8sT1vW4"].join("_");
    genuine(rec("cp-0003", { command: `STRIPE_KEY=${key} npm test`, reason: `Missing saved files: ${key}.txt` }));
    const r = tm.checkRecord(demo.ctx, "cp-0003");
    expect(r?.command).toBe(HIDDEN_COMMAND);
    expect(r?.reason).toBe(HIDDEN_REASON);
    expect(JSON.stringify(r)).not.toContain(key);
  });

  test("the log is returned as its label, as stored", () => {
    genuine(rec("cp-0003", { log: "/etc/passwd" }));
    expect(tm.checkRecord(demo.ctx, "cp-0003")?.log).toBe("/etc/passwd");
  });
});

test("a store that can't be read gives a generic error with nothing from inside it", () => {
  mkdirSync(verdicts);
  writeFileSync(join(verdicts, "inside"), "SECRET-CONTENT\n");
  let message = "";
  try {
    tm.checkRecord(demo.ctx, "cp-0003");
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  expect(message).toBe("That save point's check record couldn't be read.");
});
