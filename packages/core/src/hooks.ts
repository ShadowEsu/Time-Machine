// C15: Claude Code hooks. Save before agent turns and risky commands, check after.
import { exec, execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { audit } from "./audit.js";
import { checkpoint } from "./checkpoint.js";
import { TmError } from "./errors.js";
import { CONFIG_FILE, loadConfig } from "./config.js";
import { changedWarningDue, consentState } from "./consent.js";
import { gitRoot, resolveProject, type Project } from "./project.js";
import { clipSafe, holdsSecretValue } from "./secrets.js";
import type { Ctx, HookEvent, HookInstallResult, HookResult } from "./types.js";
import { secretValues, verify } from "./verify.js";
import { latestVerdicts } from "./verdicts.js";
import { listIds } from "./store.js";

/** Shell commands that can destroy work. A save point is taken before them. */
const GIT = String.raw`\bgit(?:\s+-[cC]\s+\S+)*\s+`;
const RISKY: RegExp[] = [
  /\brm\s+(?:-\S*\s+)*-[a-zA-Z]*[rRf][a-zA-Z]*\b/,
  /\brm\s+(?:\S+\s+)*--(?:recursive|force)\b/,
  new RegExp(`${GIT}reset\\s+(?:\\S+\\s+)*--hard\\b`),
  new RegExp(`${GIT}checkout\\b(?:\\s+\\S+)*\\s+(?:-f\\b|--force\\b|--(?:\\s|$))`),
  new RegExp(`${GIT}checkout\\s+\\.(?:\\s|$)`),
  new RegExp(`${GIT}switch\\b.*\\s(?:-f\\b|--force\\b|--discard-changes\\b)`),
  new RegExp(`${GIT}restore\\s+(?!--staged\\b)`),
  // Any short flag group with f (-f, -fd, -xfd, -ffdx) or --force. A dry run (-n, --dry-run) alone is not risky.
  new RegExp(`${GIT}clean\\s+(?:\\S+\\s+)*(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\\b`),
  new RegExp(`${GIT}push\\s+.*(?:--force\\b|-f\\b|--force-with-lease\\b)`),
  new RegExp(`${GIT}stash\\s+(?:drop|clear)\\b`),
  new RegExp(`${GIT}branch\\s+.*-D\\b`),
  new RegExp(`${GIT}rebase\\b(?!\\s+--abort)`),
  new RegExp(`${GIT}worktree\\s+remove\\b`),
  /\bfind\b.*\s-delete\b/,
  /\b(drop|truncate)\s+(table|database|schema)\b/i,
  /\bprisma\s+migrate\s+reset\b/,
  /\bdocker\s+(volume\s+rm|system\s+prune)\b/,
];

export function isRisky(command: string): boolean {
  return RISKY.some((r) => r.test(command));
}

const HookInputSchema = z.looseObject({
  cwd: z.string().optional(),
  prompt: z.string().optional(),
  tool_input: z.looseObject({ command: z.string().optional() }).optional(),
  stop_hook_active: z.boolean().optional(),
});

function clip(text: string): string {
  return clipSafe(text, 72);
}

/** The prompt of the agent turn in progress, so every save point in the turn names it. Clipped and secret safe. */
const TurnSchema = z.object({ prompt: z.string().max(200) });
const TURN_FILE = "agent-turn.json";

function turnPrompt(p: Project): string | undefined {
  try {
    const r = TurnSchema.safeParse(JSON.parse(readFileSync(join(p.store, TURN_FILE), "utf8")));
    return r.success && r.data.prompt ? r.data.prompt : undefined;
  } catch {
    return undefined;
  }
}

function claude(prompt: string | undefined): { name: string; prompt?: string } {
  return prompt ? { name: "Claude Code", prompt } : { name: "Claude Code" };
}

const none = (event: HookEvent, message = ""): HookResult => ({ event, exitCode: 0, checkpoint: null, verdict: null, message });

/** Hides free text that holds a current secret value from the project's config files. */
function screened(p: Project, text: string): string {
  return holdsSecretValue(text, secretValues([p.root], loadConfig(p.root).config)) ? "(text hidden: it contained a secret value from this project)" : text;
}

const CLAUDE_EVENT: Record<HookEvent, string> = { prompt: "UserPromptSubmit", "pre-bash": "PreToolUse", stop: "Stop" };

/** True when the project's own .claude settings already run this Time Machine hook (from tm hook install). Unreadable files count as no hook. */
function hasOwnHook(root: string, event: HookEvent): boolean {
  return ["settings.json", "settings.local.json"].some((file) => {
    try {
      const r = SettingsSchema.safeParse(JSON.parse(readFileSync(join(root, ".claude", file), "utf8")));
      const groups = r.success ? (r.data.hooks?.[CLAUDE_EVENT[event]] ?? []) : [];
      return groups.some((g) => g.hooks.some((h) => h.command !== undefined && installedCommand.test(h.command) && h.command.endsWith(` hook ${event}`)));
    } catch {
      return false;
    }
  });
}

const CHECK_CHANGED = "Time Machine: the check in timemachine.yml changed; run tm init to approve it.";

/**
 * Why a plugin hook (requireConfig) stays out, or null when it should act. It acts only when ctx.cwd
 * is in a Git repository whose root has timemachine.yml, this computer approved that exact check
 * with tm init, and the project has no hook of its own for this event. Returns "" to stay silent, or,
 * for a prompt only, a one-time notice for the user when the check changed after it was approved.
 * Never throws.
 */
function pluginSkip(ctx: Ctx, event: HookEvent): string | null {
  try {
    const root = gitRoot(ctx);
    if (root === null || !existsSync(join(root, CONFIG_FILE)) || hasOwnHook(root, event)) return "";
    const p = resolveProject(ctx);
    const { config } = loadConfig(p.root);
    const state = consentState(p, config);
    if (state === "approved") return null;
    // The changed-check notice goes out once, on a prompt, as a systemMessage Claude Code shows the user. Stop runs in the
    // background (asyncRewake), where Claude Code hands a systemMessage to Claude instead, so it stays silent. Pre-bash
    // speaks only to name a save point it just made (see runHook).
    return state === "changed" && event === "prompt" && changedWarningDue(p, config) ? CHECK_CHANGED : "";
  } catch {
    return "";
  }
}

/**
 * Runs one hook. Never throws and never blocks the agent because of its own errors.
 * Only "stop" can return exit 2, to tell the agent a working state just broke.
 * With requireConfig (the Claude Code plugin, whose hooks fire in every folder) it does nothing unless
 * the user approved this project's check with tm init on this computer: no save point, no check, no
 * audit line, no store. It also steps aside when the project's own tm hook install hooks run this event,
 * so nothing saves twice.
 */
export async function runHook(ctx: Ctx, event: HookEvent, input: unknown, opts: { requireConfig?: boolean } = {}): Promise<HookResult> {
  try {
    const parsed = HookInputSchema.safeParse(input);
    const data = parsed.success ? parsed.data : {};
    const c: Ctx = { ...ctx, cwd: data.cwd ?? ctx.cwd };
    if (opts.requireConfig) {
      const skip = pluginSkip(c, event);
      if (skip !== null) return skip ? { ...none(event), systemMessage: skip } : none(event);
    }
    const p = resolveProject(c);
    const turnFile = join(p.store, TURN_FILE);
    if (event === "prompt") {
      // The app shows "agent is working" from this line until the matching "ended".
      audit(p, "agent-turn", null, "started");
      // Record the new turn before saving, so a failed save point never leaves the previous prompt behind.
      rmSync(turnFile, { force: true });
      const text = screened(p, data.prompt ?? "");
      const prompt = clipSafe(text, 120);
      writeFileSync(turnFile, JSON.stringify({ prompt }) + "\n");
      const r = await checkpoint(c, { note: `Before agent turn: ${clip(text)}`, trigger: "claude-code:prompt", agent: claude(prompt), skipIfUnchanged: true });
      return { event, exitCode: 0, checkpoint: r.skipped ? null : r.checkpoint.id, verdict: null, message: "" };
    }
    if (event === "pre-bash") {
      const command = data.tool_input?.command ?? "";
      if (!isRisky(command)) return none(event);
      const shown = screened(p, command);
      const r = await checkpoint(c, { note: `Before risky command: ${clip(shown)}`, trigger: "claude-code:pre-bash", agent: claude(turnPrompt(p)), skipIfUnchanged: true });
      const result: HookResult = { event, exitCode: 0, checkpoint: r.checkpoint.id, verdict: null, message: "" };
      if (r.skipped) return result;
      // The one line the user sees in Claude Code, only when a new save point was made: protection at the risky moment.
      const what = shown === command ? clipSafe(command, 60, "a risky command") : "a risky command";
      return { ...result, systemMessage: `Time Machine saved ${r.checkpoint.id} before ${what}${what.endsWith("...") ? "" : "."}` };
    }
    // stop: save, check, and compare with the newest earlier verdict. The turn is over either way.
    audit(p, "agent-turn", null, "ended");
    try {
      return await stop(c, p, event, data.stop_hook_active === true);
    } finally {
      rmSync(turnFile, { force: true });
    }
  } catch (e) {
    return none(event, `Time Machine hook skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function stop(c: Ctx, p: Project, event: HookEvent, stopHookActive: boolean): Promise<HookResult> {
  const r = await checkpoint(c, { note: "After agent turn", trigger: "claude-code:stop", agent: claude(turnPrompt(p)), skipIfUnchanged: true });
  const id = r.checkpoint.id;
  // Wake only on a fresh break: this checkpoint was never checked before, and the newest
  // earlier checkpoint with a verdict passed. A known breakage is reported once.
  const before = latestVerdicts(p);
  const alreadyChecked = before.has(id);
  const num = (x: string): number => Number(x.slice(3));
  const prior = listIds(p).filter((x) => num(x) < num(id) && before.has(x)).at(-1);
  const v = await verify(c, id);
  if (v.verdict === "FAIL" && !alreadyChecked && prior && before.get(prior)?.verdict === "PASS") {
    const message = `Time Machine: the check passed at ${prior} and fails now at ${id} (${v.reason}) The last working save point is ${prior}. See what changed with: tm diff ${prior} ${id}. Do not run destructive commands to fix it; tm recover ${prior} can prepare a recovery branch without touching this folder.`;
    audit(p, "hook", id, "PASS turned into FAIL");
    if (stopHookActive) return { event, exitCode: 0, checkpoint: id, verdict: v.verdict, message };
    return { event, exitCode: 2, checkpoint: id, verdict: v.verdict, message };
  }
  return { event, exitCode: 0, checkpoint: id, verdict: v.verdict, message: "" };
}

type HookEntry = {
  type: string;
  command: string;
  timeout?: number;
  asyncRewake?: boolean;
};
const SettingsSchema = z.looseObject({
  hooks: z.record(z.string(), z.array(z.looseObject({ matcher: z.string().optional(), hooks: z.array(z.looseObject({ command: z.string().optional() })) }))).optional(),
});

/** The three lines Time Machine adds, in the order they are added. */
function wantedHooks(command: string): { event: string; matcher?: string; entry: HookEntry }[] {
  return [
    { event: "UserPromptSubmit", entry: { type: "command", command: `${command} hook prompt`, timeout: 30 } },
    { event: "PreToolUse", matcher: "Bash", entry: { type: "command", command: `${command} hook pre-bash`, timeout: 30 } },
    { event: "Stop", entry: { type: "command", command: `${command} hook stop`, timeout: 600, asyncRewake: true } },
  ];
}

// Recognize only command forms Time Machine has installed. Other tools' hooks stay untouched.
// A shell-quoted word can contain an apostrophe encoded as '\''.
const quotedWord = "'(?:[^']|'\\\\'')*'";
const installedCommand = new RegExp(`^(?:tm|npx -y timetm(?:@[\\w.-]+)?|(?:ELECTRON_RUN_AS_NODE=1 )?${quotedWord} '(?:[^']|'\\\\'')*[/\\\\](?:tm\\.js|cli\\.cjs)') hook (?:prompt|pre-bash|stop)$`);

/** Installs or reconnects our hooks, preserving other tools' hooks and project settings. */
export async function hookInstall(ctx: Ctx, opts: { command: string }): Promise<HookInstallResult> {
  const p = resolveProject(ctx);
  const settingsPath = join(p.root, ".claude", "settings.json");
  let settings: z.infer<typeof SettingsSchema> = {};
  if (existsSync(settingsPath)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      throw new TmError("usage", `${settingsPath} is not plain JSON (it may have comments), so it was left alone. Add the hooks by hand, see docs/GUIDE.md.`);
    }
    const r = SettingsSchema.safeParse(raw);
    if (!r.success) throw new TmError("usage", `${settingsPath} is not in the shape Time Machine expects, so it was left alone.`);
    settings = r.data;
  }
  const hooks = settings.hooks ?? {};
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const w of wantedHooks(opts.command)) {
    let exists = false;
    const groups = (hooks[w.event] ?? []).flatMap(group => {
      if (group.matcher !== w.matcher) return [group];
      const entries = group.hooks.filter(entry => {
        if (entry.command === w.entry.command) {
          if (exists) return false;
          exists = true;
          return true;
        }
        return !entry.command || !installedCommand.test(entry.command);
      });
      return entries.length ? [{ ...group, hooks: entries }] : [];
    });
    hooks[w.event] = groups;
    if (exists) {
      alreadyPresent.push(w.event);
      continue;
    }
    groups.push({ ...(w.matcher ? { matcher: w.matcher } : {}), hooks: [w.entry] });
    hooks[w.event] = groups;
    added.push(w.event);
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ ...settings, hooks }, null, 2) + "\n");
  audit(p, "hook-install", null, added.length ? `added ${added.join(", ")}` : "already installed");
  return { settingsPath, added, alreadyPresent };
}

/**
 * connected: every line is there and the command runs. partial: some lines, command runs.
 * not-running: lines are there but the command does not run, so no hook can save anything.
 */
export type HookState = "connected" | "partial" | "not-running" | "not-connected" | "unreadable";

export interface HookStatusResult {
  settingsPath: string;
  /** False when the file exists but is not plain JSON in the expected shape. Nothing was changed. */
  readable: boolean;
  /** Hook events that already run this command. */
  present: string[];
  missing: string[];
  /** Whether `<command> --version` printed the expected version. Null when no line is there, so nothing was run. */
  runs: boolean | null;
  state: HookState;
}

/** The hook command when no installed tm is found: npx, pinned to one exact version. */
export function npxHookCommand(version: string): string {
  return `npx -y timetm@${version}`;
}

/**
 * Whether `timetm` is published on npm by us. Until it is, nobody owns the name, so the npx fallback
 * would run whatever someone else publishes under it: it is never offered or probed. Flip this in the
 * release that publishes the package (docs/launch/NPM_PUBLISH.md).
 */
export const NPM_PUBLISHED = false;

/** The npx fallback for the hook command list: empty until the package is published. */
export function npxHookCandidates(version: string): string[] {
  return NPM_PUBLISHED ? [npxHookCommand(version)] : [];
}

/** Quotes one word for /bin/sh, so paths with spaces or quotes stay one argument. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Runs `<command> --version` in a shell, the way Claude Code runs hooks. True only when it prints `version`. */
export async function probeHookCommand(command: string, version: string, cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    const { stdout } = await promisify(exec)(`${command} --version`, { cwd, env, timeout: 15_000, encoding: "utf8" });
    return stdout.trim() === version;
  } catch {
    return false;
  }
}

/** Reads .claude/settings.json, says which of our lines are there, and checks that their command runs. Never writes. */
export async function hookStatus(ctx: Ctx, opts: { command: string; version: string }): Promise<HookStatusResult> {
  const p = resolveProject(ctx);
  const settingsPath = join(p.root, ".claude", "settings.json");
  const wanted = wantedHooks(opts.command);
  let settings: z.infer<typeof SettingsSchema> = {};
  if (existsSync(settingsPath)) {
    try {
      const r = SettingsSchema.safeParse(JSON.parse(readFileSync(settingsPath, "utf8")));
      if (!r.success) throw new Error("shape");
      settings = r.data;
    } catch {
      return { settingsPath, readable: false, present: [], missing: wanted.map((w) => w.event), runs: null, state: "unreadable" };
    }
  }
  const present = wanted.filter((w) => (settings.hooks?.[w.event] ?? []).some((g) => g.hooks.some((h) => h.command === w.entry.command))).map((w) => w.event);
  const missing = wanted.map((w) => w.event).filter((e) => !present.includes(e));
  if (!present.length) return { settingsPath, readable: true, present, missing, runs: null, state: "not-connected" };
  const runs = await probeHookCommand(opts.command, opts.version, p.root, p.env);
  const state: HookState = !runs ? "not-running" : missing.length ? "partial" : "connected";
  return { settingsPath, readable: true, present, missing, runs, state };
}

/** The plugin's id in our marketplace, as `claude plugin install time-machine@time-machine` records it. */
export const CLAUDE_PLUGIN_ID = "time-machine@time-machine";

export interface ClaudePluginStatus {
  /** Claude Code recorded an install that covers this project: user scope, or project/local scope for this folder. */
  installed: boolean;
  /** Installed and not turned off by enabledPlugins. Only then do its hooks run here. */
  enabled: boolean;
  scope: "user" | "project" | "local" | null;
  version: string | null;
}

const InstalledPluginsSchema = z.looseObject({
  plugins: z.record(
    z.string(),
    z.array(z.looseObject({ scope: z.string(), version: z.string().optional(), projectPath: z.string().optional() })),
  ),
});
const EnabledSchema = z.looseObject({ enabledPlugins: z.record(z.string(), z.boolean()).optional() });

function readJson<T>(path: string, schema: z.ZodType<T>): T | null {
  try {
    const r = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * Whether the Time Machine Claude Code plugin runs its hooks in this project. Reads only Claude Code's own
 * records: installed_plugins.json under the plugins root ($CLAUDE_CODE_PLUGIN_CACHE_DIR or ~/.claude/plugins),
 * then enabledPlugins in .claude/settings.local.json, .claude/settings.json and ~/.claude/settings.json, in
 * that order of precedence. No entry means on, the plugin's default. Never writes. Managed settings are not read.
 */
export function claudePluginStatus(ctx: Ctx): ClaudePluginStatus {
  const none: ClaudePluginStatus = { installed: false, enabled: false, scope: null, version: null };
  // Claude Code reads a folder's settings whether or not it is a Git project yet.
  const project = gitRoot(ctx) ?? resolve(ctx.cwd);
  const env = ctx.env ?? process.env;
  const home = env.HOME || homedir();
  const root = env.CLAUDE_CODE_PLUGIN_CACHE_DIR || join(home, ".claude", "plugins");
  const installed = readJson(join(root, "installed_plugins.json"), InstalledPluginsSchema);
  const entries = installed?.plugins[CLAUDE_PLUGIN_ID] ?? [];
  // A folder install beats the user install, because that is the copy Claude Code loads here.
  const folder = entries.find((e) => (e.scope === "local" || e.scope === "project") && e.projectPath !== undefined && samePath(e.projectPath, project));
  const entry = folder ?? entries.find((e) => e.scope === "user");
  if (!entry) return none;
  const files = [join(project, ".claude", "settings.local.json"), join(project, ".claude", "settings.json"), join(home, ".claude", "settings.json")];
  const setting = files.map((f) => readJson(f, EnabledSchema)?.enabledPlugins?.[CLAUDE_PLUGIN_ID]).find((v) => v !== undefined);
  return { installed: true, enabled: setting ?? true, scope: entry.scope as "user" | "project" | "local", version: entry.version ?? null };
}

/** The first line of `tm --help`. The plugin's tm-hook runs a tm only when its help starts with this line. */
export const TM_HELP_MARKER = "tm: save points for your project, checked with your own tests.";

/**
 * Whether the plugin's hooks can reach Time Machine: the same test its tm-hook script makes, the `tm` on
 * PATH printing TM_HELP_MARKER first. False when tm is missing or is another program, which is when the
 * plugin silently does nothing. It never runs in a project and never gets the caller's tokens: a project
 * can ship its own `tm`, and Windows looks in the working folder before PATH. So it runs from the home
 * folder with only the absolute PATH entries, the home variables and what Windows needs to find tm.cmd.
 */
export async function probePluginTm(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const path = (env.PATH ?? env.Path ?? "").split(delimiter).filter((entry) => entry !== "" && isAbsolute(entry)).join(delimiter);
  const minimal: NodeJS.ProcessEnv = { PATH: path };
  for (const name of ["HOME", "USERPROFILE", "SystemRoot", "PATHEXT"]) if (env[name] !== undefined) minimal[name] = env[name];
  try {
    const { stdout } = await promisify(execFile)("tm", ["--help"], { cwd: homedir(), env: minimal, shell: process.platform === "win32", timeout: 15_000, encoding: "utf8" });
    return stdout.split("\n")[0]?.trim() === TM_HELP_MARKER;
  } catch {
    return false;
  }
}
