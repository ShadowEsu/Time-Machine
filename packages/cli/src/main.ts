import { parseArgs, type ParseArgsConfig } from "node:util";
import * as tm from "@timetm/core";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fmtCheckpoint, fmtDemo, fmtDiff, fmtFindGood, fmtHookInstall, fmtInit, fmtLicense, fmtLog, fmtOpen, fmtRecover, fmtStatus, fmtTimeline, fmtVerify, makeStyle } from "./format.js";
import { serveMcp } from "./mcp.js";
import { VERSION } from "./version.js";
import { runUi } from "./ui/server.js";

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  isTTY: boolean;
  /** Standard input, for hooks and the MCP server. */
  stdin?: NodeJS.ReadableStream;
  /** Path of the CLI file that is running. `tm hook install` points the hooks at it. */
  script?: string;
}

export { VERSION };

async function readAll(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The command hooks call, best first: TM_HOOK_COMMAND, then `tm` on PATH when it is this exact version,
 * then this CLI file by its absolute path with this Node, then npx pinned to this version when running from the npx cache.
 * `absolute` is true when the command points at a file on disk.
 */
function hookCommand(io: Io): { command: string; absolute: boolean } {
  if (io.env.TM_HOOK_COMMAND) return { command: io.env.TM_HOOK_COMMAND, absolute: false };
  // Only use a `tm` on PATH if it is really this tool, not some other program named tm.
  const r = spawnSync("tm", ["--version"], { env: io.env, encoding: "utf8", timeout: 5000 });
  if (r.status === 0 && r.stdout.trim() === VERSION) return { command: "tm", absolute: false };
  if (!io.script) throw new tm.TmError("usage", "Could not tell where this tm is. Set TM_HOOK_COMMAND to the command the hooks should run.");
  // A global npm install runs tm through a symlink, so follow it to the real file.
  const script = realpathSync(io.script);
  if (/[/\\]_npx[/\\]/.test(script)) return { command: tm.npxHookCommand(VERSION), absolute: false };
  return { command: `${tm.shellQuote(process.execPath)} ${tm.shellQuote(script)}`, absolute: true };
}

const HELP = `tm: save points for your project, checked with your own tests.

Usage: tm <command> [options]

  init [--no-approve]   Create timemachine.yml with a guessed check, or keep yours, and approve
                        its check for the Claude Code plugin; --no-approve only writes the file
  status                Say if this project is set up and its check approved on this computer
  demo [dir]            Build a broken demo project and watch it get rescued
  checkpoint [-m note]  Save a checkpoint of the project as it is now
                        --if-changed skips it when nothing changed, --trigger names the source
  timeline              List checkpoints and their verdicts
  diff <a> <b>          Compare two checkpoints
  open <cp> [--dir d]   Rebuild a checkpoint in a separate folder
  verify [cp]           Run the check on a checkpoint (default: newest)
  find-good             Find the newest checkpoint that passes
  recover <cp>          Make a recovery branch and copy. Never pushes
  log                   Show the audit log
  hook install          Add Claude Code hooks to .claude/settings.json
  hook <event>          Run a hook: prompt, pre-bash or stop (reads JSON on stdin)
                        --if-initialized does nothing unless the project has timemachine.yml
  mcp                   Run the MCP server on stdio for AI agents
  ui [--port N] [--no-open]
                        Open the real local browser app; Ctrl+C stops it
  license [key]         Show the web app license on this computer, or save a key
                        --remove forgets it. The tm command line tool needs no license

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
  "if-changed": { type: "boolean" },
  "if-initialized": { type: "boolean" },
  port: { type: "string" },
  "no-open": { type: "boolean" },
  "no-approve": { type: "boolean" },
  remove: { type: "boolean" },
} as const satisfies ParseArgsConfig["options"];

const ALLOWED: Record<string, { args: [number, number]; flags: string[] }> = {
  init: { args: [0, 0], flags: ["no-approve"] },
  status: { args: [0, 0], flags: [] },
  checkpoint: { args: [0, 0], flags: ["message", "trigger", "if-changed"] },
  demo: { args: [0, 1], flags: [] },
  hook: { args: [1, 1], flags: ["if-initialized"] },
  mcp: { args: [0, 0], flags: [] },
  ui: { args: [0, 0], flags: ["port", "no-open"] },
  timeline: { args: [0, 0], flags: [] },
  diff: { args: [2, 2], flags: [] },
  open: { args: [1, 1], flags: ["dir"] },
  verify: { args: [0, 1], flags: [] },
  "find-good": { args: [0, 0], flags: [] },
  recover: { args: [1, 1], flags: [] },
  log: { args: [0, 0], flags: [] },
  license: { args: [0, 1], flags: ["remove"] },
};

/**
 * The public key that license keys are checked against. TM_LICENSE_PUBLIC_KEY replaces the embedded
 * seller key with another raw Ed25519 public key (base64url). Tests use it to sign with a throwaway
 * keypair, and a user can pin a different seller key with it. It is never read from anywhere else.
 */
function licensePublicKey(env: NodeJS.ProcessEnv): string {
  const override = env.TM_LICENSE_PUBLIC_KEY;
  if (override === undefined || override === "") return tm.LICENSE_PUBLIC_KEY;
  if (!/^[A-Za-z0-9_-]{43}$/.test(override)) throw new tm.TmError("usage", "TM_LICENSE_PUBLIC_KEY must be a raw Ed25519 public key, 32 bytes as base64url.");
  return override;
}

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
    for (const flag of ["message", "trigger", "dir", "if-changed", "if-initialized", "port", "no-open", "no-approve", "remove"] as const) {
      if (values[flag] !== undefined && !spec.flags.includes(flag)) throw new UsageError(`--${flag} does not apply to ${command}.`);
    }
    if (command === "ui" && values.json) throw new UsageError("--json does not apply to ui.");

    const ctx: tm.Ctx = { cwd: io.cwd, env: io.env };
    const style = makeStyle(io.isTTY && !io.env.NO_COLOR);
    const json = values.json === true;
    const print = (result: unknown, human: string): void => io.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : `${human}\n`);
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

    switch (command) {
      case "ui": {
        const port = values.port;
        if (port !== undefined && (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)) throw new UsageError("--port must be an integer between 1 and 65535.");
        return await runUi(io, { open: values["no-open"] !== true, ...(port !== undefined ? { port: Number(port) } : {}) });
      }
      case "init": {
        const r = await tm.init(ctx, { approve: values["no-approve"] !== true });
        print(r, fmtInit(r));
        return 0;
      }
      case "status": {
        const r = tm.status(ctx);
        print(r, fmtStatus(r));
        return 0;
      }
      case "checkpoint": {
        const note = str(values.message);
        const trigger = str(values.trigger);
        // Claude Code save points come only from `tm hook`, so a trigger cannot pose as one.
        if (trigger?.startsWith("claude-code")) throw new UsageError(`--trigger ${trigger} is kept for the Claude Code hooks. They run through tm hook.`);
        const r = await tm.checkpoint(ctx, { ...(note !== undefined ? { note } : {}), ...(trigger !== undefined ? { trigger } : {}), skipIfUnchanged: values["if-changed"] === true });
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
      case "demo": {
        const r = await tm.demo(ctx, args[0] !== undefined ? { dir: args[0] } : {});
        print(r, fmtDemo(r, style));
        return 0;
      }
      case "hook": {
        const event = args[0] ?? "";
        if (event === "install") {
          if (values["if-initialized"] !== undefined) throw new UsageError("--if-initialized does not apply to hook install.");
          const hook = hookCommand(io);
          const r = { ...(await tm.hookInstall(ctx, { command: hook.command })), ...hook };
          print(r, fmtHookInstall(r));
          return 0;
        }
        if (event !== "prompt" && event !== "pre-bash" && event !== "stop") throw new UsageError(`Unknown hook "${event}". Use install, prompt, pre-bash or stop.`);
        let input: unknown = {};
        try {
          input = JSON.parse((io.stdin ? await readAll(io.stdin) : "") || "{}");
        } catch {
          input = {};
        }
        const r = await tm.runHook(ctx, event, input, { requireConfig: values["if-initialized"] === true });
        if (json) io.stdout(`${JSON.stringify(r)}\n`);
        else if (r.systemMessage) io.stdout(`${JSON.stringify({ systemMessage: r.systemMessage })}\n`);
        if (r.message) io.stderr(`${r.message}\n`);
        return r.exitCode;
      }
      case "mcp": {
        await serveMcp(ctx, io.stdin ?? process.stdin, io.stdout);
        return 0;
      }
      case "log": {
        const r = await tm.log(ctx);
        print(r, fmtLog(r));
        return 0;
      }
      case "license": {
        const key = args[0];
        if (values.remove === true) {
          if (key !== undefined) throw new UsageError("--remove takes no key.");
          const r = tm.removeLicense(ctx);
          print(r, `License removed from this computer.\n${fmtLicense(r)}`);
          return 0;
        }
        const publicKey = licensePublicKey(io.env);
        if (key === undefined) {
          const r = tm.licenseStatus(ctx, publicKey);
          print(r, fmtLicense(r));
          return 0;
        }
        const r = tm.activateLicense(ctx, key, publicKey);
        print(r, `License saved on this computer.\n${fmtLicense(r)}`);
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
