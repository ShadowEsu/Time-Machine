import { parseArgs, type ParseArgsConfig } from "node:util";
import * as tm from "@timetm/core";
import { fmtCheckpoint, fmtDiff, fmtFindGood, fmtInit, fmtLog, fmtOpen, fmtRecover, fmtTimeline, fmtVerify, makeStyle } from "./format.js";

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  isTTY: boolean;
}

export const VERSION = "0.1.0";

const HELP = `tm: save points for your project, with proof of which ones still work.

Usage: tm <command> [options]

  init                  Create timemachine.yml with a guessed check
  checkpoint [-m note]  Save a checkpoint of the project as it is now
  timeline              List checkpoints and their verdicts
  diff <a> <b>          Compare two checkpoints
  open <cp>             Rebuild a checkpoint in a separate folder
  verify [cp]           Run the check on a checkpoint (default: newest)
  find-good             Find the newest checkpoint that passes
  recover <cp>          Make a recovery branch and copy. Never pushes
  log                   Show the audit log

Options: --json   machine readable output   -h, --help   --version

Verdict exit codes: PASS 0, FAIL 1, INCOMPLETE 2, BLOCKED 3, ERROR 4. Usage errors: 64.
Time Machine is not universal undo. Every result says what was not restored.
`;

const OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  message: { type: "string", short: "m" },
  trigger: { type: "string" },
  dir: { type: "string" },
} as const satisfies ParseArgsConfig["options"];

const ALLOWED: Record<string, { args: [number, number]; flags: string[] }> = {
  init: { args: [0, 0], flags: [] },
  checkpoint: { args: [0, 0], flags: ["message", "trigger"] },
  timeline: { args: [0, 0], flags: [] },
  diff: { args: [2, 2], flags: [] },
  open: { args: [1, 1], flags: ["dir"] },
  verify: { args: [0, 1], flags: [] },
  "find-good": { args: [0, 0], flags: [] },
  recover: { args: [1, 1], flags: [] },
  log: { args: [0, 0], flags: [] },
};

class UsageError extends Error {}

export async function main(argv: string[], io: Io): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
    const { values, positionals } = parsed;
    if (values.version) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    const [command, ...args] = positionals;
    if (values.help || !command) {
      io.stdout(HELP);
      return command || values.help ? 0 : tm.EXIT_USAGE;
    }
    const spec = ALLOWED[command];
    if (!spec) throw new UsageError(`Unknown command "${command}". Run tm --help.`);
    if (args.length < spec.args[0] || args.length > spec.args[1]) throw new UsageError(`Wrong number of arguments for ${command}. Run tm --help.`);
    for (const flag of ["message", "trigger", "dir"] as const) {
      if (values[flag] !== undefined && !spec.flags.includes(flag)) throw new UsageError(`--${flag} does not apply to ${command}.`);
    }

    const ctx: tm.Ctx = { cwd: io.cwd, env: io.env };
    const style = makeStyle(io.isTTY && !io.env.NO_COLOR);
    const json = values.json === true;
    const print = (result: unknown, human: string): void => io.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : `${human}\n`);
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

    switch (command) {
      case "init": {
        const r = await tm.init(ctx);
        print(r, fmtInit(r));
        return 0;
      }
      case "checkpoint": {
        const note = str(values.message);
        const trigger = str(values.trigger);
        const r = await tm.checkpoint(ctx, { ...(note !== undefined ? { note } : {}), ...(trigger !== undefined ? { trigger } : {}) });
        print(r, fmtCheckpoint(r));
        return 0;
      }
      case "timeline": {
        const r = await tm.timeline(ctx);
        print(r, fmtTimeline(r, style));
        return 0;
      }
      case "diff": {
        const r = await tm.diff(ctx, args[0] ?? "", args[1] ?? "");
        print(r, fmtDiff(r));
        return 0;
      }
      case "open": {
        const dir = str(values.dir);
        const r = await tm.open(ctx, args[0] ?? "", dir !== undefined ? { dir } : {});
        print(r, fmtOpen(r));
        return 0;
      }
      case "verify": {
        const r = await tm.verify(ctx, args[0]);
        print(r, fmtVerify(r, style));
        return tm.EXIT_CODES[r.verdict];
      }
      case "find-good": {
        const r = await tm.findGood(ctx);
        print(r, fmtFindGood(r, style));
        return tm.EXIT_CODES[r.verdict];
      }
      case "recover": {
        const r = await tm.recover(ctx, args[0] ?? "");
        print(r, fmtRecover(r));
        return 0;
      }
      case "log": {
        const r = await tm.log(ctx);
        print(r, fmtLog(r));
        return 0;
      }
    }
    throw new UsageError(`Unknown command "${command}".`);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`tm: ${e.message}\n`);
      return tm.EXIT_USAGE;
    }
    if (e instanceof tm.TmError) {
      io.stderr(`tm: ${e.message}\n`);
      return e.exitCode;
    }
    io.stderr(`tm: internal error: ${(e as Error).message}\n`);
    return 4;
  }
}
