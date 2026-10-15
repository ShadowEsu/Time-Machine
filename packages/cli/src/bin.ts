#!/usr/bin/env node
import { runInterruptCleanups } from "@timetm/core";
import { main } from "./main.js";

// Ctrl-C during a check: stop the check and remove its temporary copy before exiting.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    runInterruptCleanups();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  isTTY: Boolean(process.stdout.isTTY),
  stdin: process.stdin,
});
