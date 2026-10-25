// The end of a check's stored log, read back for the app: only that save point's own log, never through a link,
// only the file's last 64 KB, nothing binary, escapes stripped, and secrets hidden with today's .env values.
// Synthetic logs written straight into a temp store.
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import type * as Fs from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { tempDir, writeConfig } from "../../../fixtures/demo/setup.ts";

// Every read of a file, so the tail test can prove it read only the end and never the whole log. `fifoRace` makes
// lstat call a pipe under a log's name a regular file: a pipe swapped in between the lstat and the open.
const io = vi.hoisted(() => ({ readBytes: 0, wholeLogReads: 0, fifoRace: false }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof Fs>();
  const readSync = ((...a: Parameters<typeof real.readSync>) => {
    const n = real.readSync(...a);
    io.readBytes += n;
    return n;
  }) as typeof real.readSync;
  const readFileSync = ((...a: Parameters<typeof real.readFileSync>) => {
    if (String(a[0]).endsWith(".log")) io.wholeLogReads++;
    return real.readFileSync(...a);
  }) as typeof real.readFileSync;
  const lstatSync = ((...a: Parameters<typeof real.lstatSync>) => {
    const s = real.lstatSync(...a);
    return io.fifoRace && s && String(a[0]).endsWith(".log") ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, { isFile: () => true }) : s;
  }) as typeof real.lstatSync;
  return { ...real, default: { ...real, readSync, readFileSync, lstatSync }, readSync, readFileSync, lstatSync };
});

const STAMP = "2026-10-24T01-02-03-004Z";
const LATER = "2026-10-24T05-06-07-008Z";

function project(): { dir: string; ctx: tm.Ctx; logs: string } {
  const root = tempDir("logtail");
  const dir = join(root, "app");
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  writeConfig(dir);
  write(dir, "index.js", "module.exports = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "start");
  const tmHome = join(root, "store");
  const ctx: tm.Ctx = { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } };
  const logs = join(tm.storeDirFor(ctx), "logs");
  mkdirSync(logs, { recursive: true });
  return { dir, ctx, logs };
}

const lines = (n: number, f: (i: number) => string): string => Array.from({ length: n }, (_, i) => f(i)).join("\n");

beforeEach(() => {
  io.readBytes = 0;
  io.wholeLogReads = 0;
  io.fifoRace = false;
});

describe("which log is read", () => {
  test("T1 only the save point's own log: never a longer id's, never a hand-made name", () => {
    const { ctx, logs } = project();
    writeFileSync(join(logs, `cp-00120-${STAMP}.log`), "from cp-00120\n");
    writeFileSync(join(logs, "cp-0012-x.log"), "hand made\n");
    writeFileSync(join(logs, `cp-0012-${STAMP}.log.bak`), "a backup\n");
    expect(tm.checkLogTail(ctx, "cp-0012")).toBeNull();
    writeFileSync(join(logs, `cp-0012-${STAMP}.log`), "older run\n");
    writeFileSync(join(logs, `cp-0012-${LATER}.log`), "newest run\n");
    expect(tm.checkLogTail(ctx, "cp-0012")).toEqual({ log: join(logs, `cp-0012-${LATER}.log`), lines: ["newest run"], binary: false, hidden: false });
  });

  test("T2 a link planted under the log's name is never followed, and its target never shows", () => {
    const { ctx, logs } = project();
    const outside = join(tempDir("outside"), "id_rsa");
    writeFileSync(outside, "OUTSIDE-FILE-CONTENT\n");
    symlinkSync(outside, join(logs, `cp-0012-${STAMP}.log`));
    let message = "";
    try {
      tm.checkLogTail(ctx, "cp-0012");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toBe("That log couldn't be read.");
    expect(message).not.toContain("OUTSIDE");
  });

  test("T2 a linked logs folder is not read", () => {
    const { ctx, logs } = project();
    const elsewhere = tempDir("elsewhere");
    writeFileSync(join(elsewhere, `cp-0012-${STAMP}.log`), "OUTSIDE-FILE-CONTENT\n");
    // The store's logs folder is replaced by a link to another folder.
    const store = join(logs, "..");
    renameSync(logs, join(store, "logs-moved"));
    symlinkSync(elsewhere, logs);
    expect(tm.checkLogTail(ctx, "cp-0012")).toBeNull();
  });

  // Without O_NONBLOCK this open waits for a writer forever and the run hangs, so a hang here is the failure.
  test.skipIf(process.platform === "win32")("T2 a pipe swapped in under the log's name after the lstat is refused at once", () => {
    const { ctx, logs } = project();
    execFileSync("mkfifo", [join(logs, `cp-0012-${STAMP}.log`)]);
    io.fifoRace = true;
    expect(() => tm.checkLogTail(ctx, "cp-0012")).toThrow("That log couldn't be read.");
  });
});

describe("how much is read", () => {
  test("T3 a 5 MB log gives exactly its last 20 lines, from one read of at most 64 KB", () => {
    const { ctx, logs } = project();
    const all = lines(60_000, (i) => `line ${String(i).padStart(6, "0")} ${"x".repeat(70)}`);
    expect(all.length).toBeGreaterThan(4_000_000);
    writeFileSync(join(logs, `cp-0012-${STAMP}.log`), `${all}\n`);
    io.readBytes = 0;
    const t = tm.checkLogTail(ctx, "cp-0012");
    // The spy saw the read (so the bound means something), and it was the file's end only.
    expect(io.readBytes).toBeGreaterThan(0);
    expect(io.readBytes).toBeLessThanOrEqual(tm.TAIL_READ_BYTES);
    expect(io.wholeLogReads).toBe(0);
    // 20 lines of 82 bytes fit the 4 KB cap; each is the original line.
    expect(t?.lines).toEqual(all.split("\n").slice(-20));
  });

  test("T3 a read that starts inside a key never shows the piece of it that it caught", () => {
    const { ctx, logs } = project();
    const key = `sk_live_${"Q1w2E3r4T5y6U7i8O9p0".repeat(2)}`;
    // One line of colour codes (empty once cleaned) puts the read's first byte 19 characters before the key's end.
    const after = `${"\x1b[0m".repeat(16_375)}\nend of the run\n`;
    const head = `paying with ${key}\n`;
    writeFileSync(join(logs, `cp-0012-${STAMP}.log`), head + after);
    const start = Buffer.byteLength(head + after) - tm.TAIL_READ_BYTES;
    expect(start).toBeGreaterThan(head.indexOf(key));
    expect(head.length - start).toBe(20);
    const t = tm.checkLogTail(ctx, "cp-0012");
    expect(t?.lines).toEqual(["end of the run"]);
    expect(JSON.stringify(t)).not.toContain(key.slice(-19));
  });

  test("T4 a log with NUL bytes is binary: no text at all", () => {
    const { ctx, logs } = project();
    writeFileSync(join(logs, `cp-0012-${STAMP}.log`), Buffer.concat([Buffer.from("readable start\n"), Buffer.from([0, 1, 2, 0]), Buffer.from("\nreadable end\n")]));
    expect(tm.checkLogTail(ctx, "cp-0012")).toEqual({ log: join(logs, `cp-0012-${STAMP}.log`), lines: [], binary: true, hidden: false });
  });

  test("T9 at most 20 lines, 300 code points a line, 4 KB in all", () => {
    const { ctx, logs } = project();
    const file = join(logs, `cp-0012-${STAMP}.log`);
    writeFileSync(file, `${lines(25, (i) => `row ${i}`)}\n`);
    expect(tm.checkLogTail(ctx, "cp-0012")?.lines).toEqual(Array.from({ length: 20 }, (_, i) => `row ${i + 5}`));

    writeFileSync(file, `${"é".repeat(1000)}\n`);
    const long = tm.checkLogTail(ctx, "cp-0012")?.lines[0] ?? "";
    expect(Array.from(long)).toHaveLength(300);
    expect(long.endsWith("...")).toBe(true);

    writeFileSync(file, `${lines(20, (i) => `${i} ${"y".repeat(280)}`)}\n`);
    const capped = tm.checkLogTail(ctx, "cp-0012")?.lines ?? [];
    expect(Buffer.byteLength(capped.join("\n"))).toBeLessThanOrEqual(4096);
    expect(capped.length).toBeGreaterThan(0);
    // The lines kept are the last ones.
    expect(capped.at(-1)?.startsWith("19 ")).toBe(true);
  });
});

describe("what is shown", () => {
  test("T5 a .env value added after the log was written is redacted when it is read", () => {
    const { dir, ctx, logs } = project();
    writeFileSync(join(logs, `cp-0012-${STAMP}.log`), "connecting with Wq7pLm2xRt9 now\nok\n");
    write(dir, ".env", "PAYMENTS_PASSCODE=Wq7pLm2xRt9\n");
    expect(tm.checkLogTail(ctx, "cp-0012")?.lines).toEqual(["connecting with [redacted] now", "ok"]);
  });

  test("T6 a line that looks like a key is hidden; the others still show", () => {
    const { ctx, logs } = project();
    writeFileSync(join(logs, `cp-0012-${STAMP}.log`), `before\nusing sk_test_${"a".repeat(24)} for payments\nafter\n`);
    expect(tm.checkLogTail(ctx, "cp-0012")?.lines).toEqual(["before", "(line hidden: it looked like it contained a secret)", "after"]);
  });

  test("T7 a private key in the tail hides the whole tail, body lines included", () => {
    const { ctx, logs } = project();
    const file = join(logs, `cp-0012-${STAMP}.log`);
    const body = lines(6, () => "MIIEowIBAAKCAQEAz9v1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789ab");
    writeFileSync(file, `test output\n-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\ndone\n`);
    expect(tm.checkLogTail(ctx, "cp-0012")).toEqual({ log: file, lines: [], binary: false, hidden: true });
    // Its BEGIN line far above the last 20 lines still hides the body lines that are in them.
    writeFileSync(file, `-----BEGIN PRIVATE KEY-----\n${lines(40, () => "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7")}\n`);
    expect(tm.checkLogTail(ctx, "cp-0012")?.hidden).toBe(true);
  });

  test("T7 a secret split over two lines hides the whole tail", () => {
    const { ctx, logs } = project();
    writeFileSync(join(logs, `cp-0012-${STAMP}.log`), "loading settings\nAPI_KEY\n= hunter2hunter2\ndone\n");
    expect(tm.checkLogTail(ctx, "cp-0012")?.hidden).toBe(true);
  });

  test("T8 terminal escapes and bidi controls are removed", () => {
    const { ctx, logs } = project();
    writeFileSync(join(logs, `cp-0012-${STAMP}.log`), "\x1b[31mred\x1b[0m\nabc\u202edef\n\x1b]0;window title\x07after\nbell\x07 tab\there\n");
    expect(tm.checkLogTail(ctx, "cp-0012")?.lines).toEqual(["red", "abcdef", "after", "bell tab  here"]);
  });
});

test("a save point with no stored log has none, and a bad id is refused", () => {
  const { ctx } = project();
  expect(tm.checkLogTail(ctx, "cp-0001")).toBeNull();
  expect(() => tm.checkLogTail(ctx, "cp-0012/../x")).toThrow(tm.TmError);
});
