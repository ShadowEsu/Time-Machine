// A check's log is written while the check runs, so the app can show what it prints so far. Each write holds only
// whole lines, redacted with the same secret values the final log uses, and never the end of a line still coming in.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { git, write } from "../../../fixtures/demo/build.ts";
import { setupDemo, writeConfig } from "../../../fixtures/demo/setup.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function logsOf(ctx: tm.Ctx, id: string): string[] {
  const dir = join(tm.storeDirFor(ctx), "logs");
  return readdirSync(dir).filter((n) => n.startsWith(`${id}-`)).map((n) => readFileSync(join(dir, n), "utf8"));
}

/** Waits until the save point's log holds `text`, or gives up after 15 s. */
async function logWith(ctx: tm.Ctx, id: string, text: string): Promise<string[]> {
  const until = Date.now() + 15_000;
  for (;;) {
    const logs = logsOf(ctx, id);
    if (logs.some((l) => l.includes(text)) || Date.now() > until) return logs;
    await sleep(100);
  }
}

describe("live check log", () => {
  test("the log holds the lines printed so far while the check still runs, with secrets hidden", async () => {
    const { dir, ctx } = await setupDemo();
    write(dir, "config/secrets.env", "API_KEY=oldvalue123456\n");
    git(dir, "add", "config/secrets.env");
    git(dir, "commit", "-q", "-m", "add secrets env");
    // The secret line, then the start of a line that only ends 4 s later.
    writeConfig(dir, { command: "echo one; sleep 1; cat config/secrets.env; printf 'tail-without-newline'; sleep 4; echo; echo done" }, [".env", "config/secrets.env"]);
    const cp = await tm.checkpoint(ctx, { note: "x" });
    const id = cp.checkpoint.id;
    const run = tm.verify(ctx, id);
    const during = await logWith(ctx, id, "API_KEY=");
    expect(during).toHaveLength(1);
    // The first line echoes the command itself; what the check printed starts after it.
    const printed = (log: string): string => log.slice(log.indexOf("\n") + 1);
    expect(printed(during[0]!)).toBe("one\nAPI_KEY=[redacted]\n");
    // A line still being printed stays out until its newline arrives.
    const v = await run;
    expect(v.verdict).toBe("PASS");
    const final = printed(readFileSync(v.log!, "utf8"));
    expect(final).toBe("one\nAPI_KEY=[redacted]\ntail-without-newline\ndone\n");
  }, 90_000);
});
