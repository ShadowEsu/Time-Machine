import { parseArgs, type ParseArgsConfig } from "node:util";
import * as tm from "@timetm/core";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fmtCheckpoint, fmtDemo, fmtDiff, fmtDoctor, fmtFindGood, fmtForget, fmtHookInstall, fmtInit, fmtLicense, fmtList, fmtLog, fmtOpen, fmtRecover, fmtRelink, fmtRestore, fmtStatus, fmtThin, fmtTimeline, fmtUndoRecover, fmtVerify, makeStyle } from "./format.js";
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

// The first line is what the Claude Code plugin's tm-hook checks before it runs this tm (TM_HELP_MARKER).
const HELP = `${tm.TM_HELP_MARKER}

Usage: tm <command> [options]

  init [--no-approve]   Create timemachine.yml with a guessed check, or keep yours, and approve
                        its check for the Claude Code plugin; --no-approve only writes the file
  status                Say if this project is set up and its check approved on this computer
  forget                Take back this computer's approval and remove the hook lines tm added;
                        save points stay
  demo [dir]            Build a broken demo project and watch it get rescued
  checkpoint [-m note]  Save a checkpoint of the project as it is now
                        --if-changed skips it when nothing changed, --trigger names the source
  timeline              List checkpoints and their verdicts
  diff <a> <b>          Compare two checkpoints
  open <cp> [--dir d]   Rebuild a checkpoint in a separate folder
  verify [cp]           Run the check on a checkpoint (default: newest)
  find-good             Find the newest checkpoint that passes
  recover <cp> [--to f] Make a recovery branch and copy (in folder f if given). Never pushes
  recover --undo <cp>   Remove a recovery's branch and copy, only while nothing in them changed
  restore <cp> [--dry-run] -- <path>...
                        Put files or folders back from a save point into your folder; saves first
  relink <old> <new>    A project's folder moved: keep its history at the new path
  list                  List every project in the store, with its save points and size
  thin [--apply]        Show which old auto saves can go; --apply removes them
  doctor                Check every save point in the store for damage
  log                   Show the audit log
  hook install          Add Claude Code hooks to .claude/settings.json
  hook <event>          Run a hook: prompt, pre-bash or stop (reads JSON on stdin)
                        --if-initialized does nothing unless the project has timemachine.yml
  mcp                   Run the MCP server on stdio for AI agents
  ui [--port N] [--no-open]
                        Open the real local browser app; Ctrl+C stops it
  license [key]         Show the web app license on this computer, or save a key
                        --remove forgets it. The tm command line tool needs no license

Options: --json   machine readable output   -C, --project <path>   the project's folder (default: here)
         -h, --help (also tm <command> --help)   --version

Verdict exit codes: PASS 0, FAIL 1, INCOMPLETE 2, BLOCKED 3, ERROR 4. Usage errors: 64.
Time Machine is not universal undo. Every result says what was not restored.
`;

const OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  project: { type: "string", short: "C" },
  message: { type: "string", short: "m" },
  trigger: { type: "string" },
  dir: { type: "string" },
  to: { type: "string" },
  apply: { type: "boolean" },
  "if-changed": { type: "boolean" },
  "if-initialized": { type: "boolean" },
  port: { type: "string" },
  "no-open": { type: "boolean" },
  "no-approve": { type: "boolean" },
  remove: { type: "boolean" },
  "dry-run": { type: "boolean" },
  undo: { type: "boolean" },
} as const satisfies ParseArgsConfig["options"];

type Flag = Exclude<keyof typeof OPTIONS, "json" | "help" | "version">;
const FLAGS: readonly Flag[] = ["project", "message", "trigger", "dir", "to", "apply", "if-changed", "if-initialized", "port", "no-open", "no-approve", "remove", "dry-run", "undo"];

const FLAG_HELP: Record<Flag, string> = {
  project: "-C, --project <path>  The project's folder, even one that was moved or deleted (default: here)",
  message: "-m, --message <note>  A note for the save point",
  trigger: "--trigger <source>    What made it: manual (default), auto, app or mcp",
  dir: "--dir <folder>        Where to put the copy; it must not exist yet (default: a new temp folder)",
  to: "--to <folder>         An existing folder to put the recovery copy in (default: next to the project)",
  apply: "--apply               Remove them. Without it, only show what would go",
  "if-changed": "--if-changed          Save only when something changed since the newest save point",
  "if-initialized": "--if-initialized      Do nothing unless the project has timemachine.yml",
  port: "--port <N>            The port to listen on (default: any free port)",
  "no-open": "--no-open             Do not open the browser",
  "no-approve": "--no-approve          Write or keep timemachine.yml, but do not approve its check",
  remove: "--remove              Forget the license on this computer",
  "dry-run": "--dry-run             Say what would come back, and write nothing",
  undo: "--undo                Undo a recovery instead: <cp>, its branch, or its copy's folder",
};

interface Spec {
  args: [number, number];
  flags: Flag[];
  usage: string;
  about: string;
  example: string;
}

const COMMANDS: Record<string, Spec> = {
  init: { args: [0, 0], flags: ["no-approve", "project"], usage: "tm init [--no-approve]", about: "Protect this project: a Git repository gets timemachine.yml with a guessed check, a plain folder gets its settings in the store. Approves the check on this computer.", example: "tm init" },
  status: { args: [0, 0], flags: ["project"], usage: "tm status", about: "Say if this project is set up, where its settings are, and if its check is approved on this computer.", example: "tm status" },
  forget: { args: [0, 0], flags: ["project"], usage: "tm forget", about: "Take back what tm init and tm hook install agreed to on this computer: the check's approval is removed, so the Claude Code plugin and the MCP check tools do nothing here, and the hook lines tm hook install added to .claude/settings.json are removed. Other tools' hooks stay. Save points stay in the store until you delete them. tm init sets it up again.", example: "tm forget" },
  checkpoint: { args: [0, 0], flags: ["message", "trigger", "if-changed", "project"], usage: "tm checkpoint [-m <note>] [--if-changed] [--trigger <source>]", about: "Save a checkpoint of the project as it is now. Every result lists what was not saved.", example: 'tm checkpoint -m "before the big rewrite"' },
  demo: { args: [0, 1], flags: [], usage: "tm demo [dir]", about: "Build a broken demo project and watch it get rescued.", example: "tm demo /tmp/marigold" },
  hook: { args: [1, 1], flags: ["if-initialized"], usage: "tm hook <install|prompt|pre-bash|stop> [--if-initialized]", about: "Add Claude Code hooks to .claude/settings.json (install), or run one hook, reading its JSON on stdin.", example: "tm hook install" },
  mcp: { args: [0, 0], flags: [], usage: "tm mcp", about: "Run the MCP server on stdio for AI agents.", example: "claude mcp add timemachine -- tm mcp" },
  ui: { args: [0, 0], flags: ["port", "no-open"], usage: "tm ui [--port <N>] [--no-open]", about: "Open the local browser app. Ctrl+C stops it.", example: "tm ui --port 4560" },
  timeline: { args: [0, 0], flags: ["project"], usage: "tm timeline", about: "List the save points, newest first, with their verdicts. Damaged ones are marked.", example: "tm timeline -C ~/Documents/Thesis" },
  diff: { args: [2, 2], flags: ["project"], usage: "tm diff <a> <b>", about: "Compare two save points: code, saved files, config keys, dependencies and environment.", example: "tm diff cp-0002 cp-0005" },
  open: { args: [1, 1], flags: ["dir", "project"], usage: "tm open <cp> [--dir <folder>]", about: "Rebuild a save point in a separate folder. Your folder is not touched. Exits 2 when something saved is missing.", example: "tm open cp-0003 --dir ~/Desktop/thesis-cp-0003" },
  verify: { args: [0, 1], flags: ["project"], usage: "tm verify [cp]", about: "Run the project's check on a save point in a separate copy (default: the newest).", example: "tm verify cp-0004" },
  "find-good": { args: [0, 0], flags: ["project"], usage: "tm find-good", about: "Check save points from the newest back until one passes.", example: "tm find-good" },
  recover: { args: [1, 1], flags: ["to", "undo", "project"], usage: "tm recover <cp> [--to <folder>]   or   tm recover --undo <cp | branch | copy folder>", about: "Bring a save point back as a recovery copy (and a branch, for Git). Saves the current state first. Never pushes. Works for a folder that was moved or deleted too. --undo removes a recovery's branch and copy again, but only while both are as the recovery left them; it never touches your folder, your branch or a save point.", example: "tm recover cp-0003 -C ~/Documents/Thesis --to ~/Desktop" },
  restore: { args: [2, Infinity], flags: ["dry-run", "project"], usage: "tm restore <cp> [--dry-run] -- <path> [<path>...]", about: "Put files or folders back from a save point into your folder. Paths are relative to the project's folder; a folder brings back everything saved under it. Your folder is saved first, so what this replaces stays in the history. Nothing is deleted: files the save point lacks are kept. A Git project gets files only, nothing committed. Exits 2 when a path was skipped.", example: "tm restore cp-0003 -- chapter-1.md notes/" },
  relink: { args: [2, 2], flags: [], usage: "tm relink <old path> <new path>", about: "A project's folder moved: point Time Machine at the new path. Its save points, settings and notes come along.", example: "tm relink ~/Documents/Thesis ~/Dropbox/Thesis" },
  list: { args: [0, 0], flags: [], usage: "tm list", about: "List every project in the store: its path, kind, save points and size, and whether its folder is gone.", example: "tm list" },
  thin: { args: [0, 0], flags: ["apply", "project"], usage: "tm thin [--apply]", about: "Show which old auto saves can go, and why; --apply removes them. Working, pinned, named and recent save points always stay.", example: "tm thin --apply" },
  doctor: { args: [0, 0], flags: [], usage: "tm doctor", about: "Check every save point in the store: manifests, Git refs and saved copies. Exits 2 when something is damaged.", example: "tm doctor" },
  log: { args: [0, 0], flags: ["project"], usage: "tm log", about: "Show the audit log, in local time with the time zone.", example: "tm log" },
  license: { args: [0, 1], flags: ["remove"], usage: "tm license [key] [--remove]", about: "Show the web app license on this computer, save a key, or forget it. The tm command line tool needs no license.", example: "tm license tm1.ABC..." },
};

/** What --trigger may name. Claude Code triggers are kept for the hooks. */
const TRIGGERS = ["manual", "auto", "app", "mcp"];

function commandHelp(name: string, spec: Spec): string {
  const options = [...spec.flags.map((f) => FLAG_HELP[f]), ...(name === "ui" ? [] : ["--json                Machine readable output"])];
  return [`Usage: ${spec.usage}`, "", spec.about, "", "Options:", ...options.map((o) => `  ${o}`), "", "Example:", `  ${spec.example}`, ""].join("\n");
}

class UsageError extends Error {}

/** parseArgs errors in plain words, pointing at the help of the command they came from. */
function parseError(e: unknown, argv: string[]): UsageError {
  const msg = e instanceof Error ? e.message : String(e);
  const command = argv.find((a) => COMMANDS[a] !== undefined);
  const hint = command ? `tm ${command} --help` : "tm --help";
  const unknown = /Unknown option '([^']+)'/.exec(msg);
  if (unknown) return new UsageError(`Unknown option ${unknown[1]}. Run ${hint}.`);
  const missing = /Option '(?:-\w, )?(--[\w-]+)/.exec(msg);
  if (missing && /argument missing/.test(msg)) return new UsageError(`${missing[1]} needs a value. Run ${hint}.`);
  return new UsageError(`${msg} Run ${hint}.`);
}

export async function main(argv: string[], io: Io): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch (e) {
      throw parseError(e, argv);
    }
    const { values, positionals } = parsed;
    if (values.version) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    const [command, ...args] = positionals;
    if (!command) {
      io.stdout(HELP);
      return values.help ? 0 : tm.EXIT_USAGE;
    }
    const spec = COMMANDS[command];
    if (!spec) throw new UsageError(`Unknown command "${command}". Run tm --help.`);
    if (values.help) {
      io.stdout(commandHelp(command, spec));
      return 0;
    }
    if (args.length < spec.args[0] || args.length > spec.args[1]) throw new UsageError(`Wrong number of arguments for ${command}. Usage: ${spec.usage}`);
    for (const flag of FLAGS) {
      if (values[flag] !== undefined && !spec.flags.includes(flag)) throw new UsageError(`--${flag} does not apply to ${command}. Run tm ${command} --help.`);
    }
    if (command === "ui" && values.json) throw new UsageError("--json does not apply to ui.");

    const project = values.project;
    const ctx: tm.Ctx = { cwd: project !== undefined ? resolve(io.cwd, project) : io.cwd, env: io.env };
    const style = makeStyle(io.isTTY && !io.env.NO_COLOR);
    const json = values.json === true;
    const print = (result: unknown, human: string): void => io.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : `${human}\n`);
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    /** INCOMPLETE when the copy lacks something the save point had. */
    const complete = (missing: string[]): number => (missing.length ? tm.EXIT_CODES.INCOMPLETE : 0);

    switch (command) {
      case "ui": {
        const port = values.port;
        if (port !== undefined && (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)) throw new UsageError("--port must be an integer between 1 and 65535.");
        try {
          return await runUi(io, { open: values["no-open"] !== true, ...(port !== undefined ? { port: Number(port) } : {}) });
        } catch (e) {
          if (!(e instanceof Error) || !("code" in e) || e.code !== "EADDRINUSE") throw e;
          const busy = Number(port ?? /:(\d+)\s*$/.exec(e.message)?.[1] ?? 0);
          throw new UsageError(`Port ${busy} is in use (maybe another tm ui). Use --port ${busy >= 65535 ? busy - 1 : busy + 1}.`);
        }
      }
      case "init": {
        const r = await tm.init(ctx, { approve: values["no-approve"] !== true });
        print(r, fmtInit(r));
        return 0;
      }
      case "status": {
        let r: tm.StatusResult;
        try {
          r = tm.status(ctx);
        } catch (e) {
          // Status is a question: a folder nobody set up is an answer, not an error.
          if (!(e instanceof tm.TmError) || e.kind !== "not_found" || !existsSync(ctx.cwd)) throw e;
          print({ initialized: false, approved: false, check: null, kind: null, configPath: null }, "Not set up here. Run tm init.");
          return 0;
        }
        print(r, fmtStatus(r));
        return 0;
      }
      case "forget": {
        const r = tm.forget(ctx);
        print(r, fmtForget(r));
        return 0;
      }
      case "checkpoint": {
        const note = str(values.message);
        const trigger = str(values.trigger);
        // Claude Code save points come only from `tm hook`, so a trigger cannot pose as one.
        if (trigger?.startsWith("claude-code")) throw new UsageError(`--trigger ${trigger} is kept for the Claude Code hooks. They run through tm hook.`);
        if (trigger !== undefined && !TRIGGERS.includes(trigger)) throw new UsageError(`--trigger must be one of ${TRIGGERS.join(", ")}.`);
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
        const r = await tm.open(ctx, args[0] ?? "", dir !== undefined ? { dir: resolve(io.cwd, dir) } : {});
        print(r, fmtOpen(r));
        return complete(r.missing);
      }
      case "verify": {
        // A check can take minutes. On a terminal, say what is running before it starts (stderr, so stdout stays the result).
        if (io.isTTY && !json) io.stderr(`Checking ${args[0] ?? "the newest save point"} in a separate copy. Ctrl+C stops.\n`);
        const r = await tm.verify(ctx, args[0]);
        print(r, fmtVerify(r, style));
        return tm.EXIT_CODES[r.verdict];
      }
      case "find-good": {
        const onTry = io.isTTY && !json ? (id: string, n: number, of: number) => io.stderr(`Checking ${id} (${n} of ${of}, newest first). Ctrl+C stops.\n`) : undefined;
        const r = await tm.findGood(ctx, onTry ? { onTry } : {});
        print(r, fmtFindGood(r, style));
        return tm.EXIT_CODES[r.verdict];
      }
      case "recover": {
        const to = str(values.to);
        if (values.undo === true) {
          if (to !== undefined) throw new UsageError("--to does not apply with --undo.");
          const target = args[0] ?? "";
          const branchMatch = /^tm\/recover\/(cp-\d+)(-\d+)?$/.exec(target);
          let found = tm.recoveries(ctx, /^cp-\d+$/.test(target) ? target : branchMatch?.[1]);
          if (branchMatch) found = found.filter((x) => x.branch === target);
          else if (!/^cp-\d+$/.test(target)) {
            const dir = resolve(io.cwd, target);
            const real = existsSync(dir) ? realpathSync(dir) : dir;
            found = found.filter((x) => x.copyDir === real);
          }
          const one = found[0];
          if (!one) throw new tm.TmError("not_found", `There is no recovery of ${target} to undo. tm log lists the recoveries that were made.`);
          if (found.length > 1) {
            const listed = found.map((x) => `  ${x.branch || x.copyDir}${x.branch && x.copyDir ? `   copy ${x.copyDir}` : ""}`).join("\n");
            throw new UsageError(`${target} has ${found.length} recoveries. Name the one to undo by its branch or copy folder:\n${listed}`);
          }
          const r = await tm.undoRecover(ctx, one);
          print(r, fmtUndoRecover(r));
          return 0;
        }
        const r = await tm.recover(ctx, args[0] ?? "", to !== undefined ? { dest: resolve(io.cwd, to) } : {});
        print(r, fmtRecover(r));
        return complete(r.missing);
      }
      case "restore": {
        const [id = "", ...paths] = args;
        const r = await tm.restorePaths(ctx, id, paths, { dryRun: values["dry-run"] === true });
        print(r, fmtRestore(r));
        return r.skipped.length ? tm.EXIT_CODES.INCOMPLETE : 0;
      }
      case "relink": {
        const [from = "", to = ""] = args;
        const r = await tm.relinkProject({ ...ctx, cwd: resolve(io.cwd, from) }, to.startsWith("~") ? to : resolve(io.cwd, to));
        print(r, fmtRelink(r));
        return 0;
      }
      case "list": {
        const r = tm.storeProjects(ctx);
        print({ projects: r }, fmtList(r));
        return 0;
      }
      case "thin": {
        const preview = tm.thinPreview(ctx);
        const removed = values.apply === true && preview.remove.length ? (await tm.thinApply(ctx, preview.remove.map((x) => x.id))).removed : null;
        print({ ...preview, removed }, fmtThin(preview, removed));
        return 0;
      }
      case "doctor": {
        const r = tm.checkStore(ctx);
        print({ projects: r }, fmtDoctor(r));
        return r.some((x) => x.damaged.length || x.missingBlobs.length) ? tm.EXIT_CODES.INCOMPLETE : 0;
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
        const publicKey = tm.licensePublicKeyFromEnv(io.env);
        if (values.remove === true) {
          if (key !== undefined) throw new UsageError("--remove takes no key.");
          const before = tm.licenseStatus(ctx, publicKey);
          const r = tm.removeLicense(ctx);
          print(r, before.active || before.problem !== null ? `License removed from this computer.\n${fmtLicense(r)}` : `There was no license on this computer.\n${fmtLicense(r)}`);
          return 0;
        }
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
