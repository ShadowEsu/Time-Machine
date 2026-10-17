// Facts the Mac app may describe to an assistant the person turned on: the check behind each
// verdict, and a screen for free text that holds secrets.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as tm from "@timetm/core";
import { FAKE_SECRET } from "../src/demo-project.ts";
import { setupDemo } from "../../../fixtures/demo/setup.ts";

describe("history facts", () => {
  test("checkRuns gives the command and exit code of the newest check, never its output", async () => {
    const { ctx } = await setupDemo();
    await tm.verify(ctx, "cp-0003");
    await tm.verify(ctx, "cp-0004");
    const runs = tm.checkRuns(ctx);
    expect(runs.get("cp-0003")).toEqual({ command: "node --test", exitCode: 0 });
    expect(runs.get("cp-0004")?.exitCode).not.toBe(0);
    expect(runs.has("cp-0001")).toBe(false);
    expect(Object.keys(runs.get("cp-0004") ?? {}).sort()).toEqual(["command", "exitCode"]);
  });

  test("secretScreen flags secret looking text and values from the project's .env, and passes plain text", async () => {
    const { ctx, dir } = await setupDemo();
    // A value that does not look like a key: only the .env file says it is secret.
    writeFileSync(join(dir, ".env"), `PORT=3000\nDB_HINT=marigold-river-otter\nSTRIPE_SECRET_KEY=${FAKE_SECRET}\n`);
    const flagged = tm.secretScreen(ctx);
    expect(flagged(`deploy with ${FAKE_SECRET}`)).toBe(true);
    expect(flagged("connect to marigold-river-otter now")).toBe(true);
    expect(flagged("token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe(true);
    expect(flagged("Added dark mode")).toBe(false);
    // PORT is listed as plain in the demo config, so its value is not a secret.
    expect(flagged("listen on 3000")).toBe(false);
  });
});
