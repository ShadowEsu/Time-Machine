// C15: Claude Code hooks. Save before agent turns and risky commands, check after.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { audit } from "./audit.js";
import { checkpoint } from "./checkpoint.js";
import { TmError } from "./errors.js";
import { resolveProject, type Project } from "./project.js";
import { clipSafe } from "./secrets.js";
import type { Ctx, HookEvent, HookInstallResult, HookResult } from "./types.js";
import { verify } from "./verify.js";
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
  new RegExp(`${GIT}clean\\s+(?:\\S+\\s+)*(?:-[a-zA-Z]*f|--force)\\b`),
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

/**
 * Runs one hook. Never throws and never blocks the agent because of its own errors.
 * Only "stop" can return exit 2, to tell the agent a working state just broke.
 */
export async function runHook(ctx: Ctx, event: HookEvent, input: unknown): Promise<HookResult> {
  try {
    const parsed = HookInputSchema.safeParse(input);
    const data = parsed.success ? parsed.data : {};
    const c: Ctx = { ...ctx, cwd: data.cwd ?? ctx.cwd };
    const p = resolveProject(c);
    if (event === "prompt") {
      // The app shows "agent is working" from this line until the matching "ended".
      audit(p, "agent-turn", null, "started");
      const prompt = clipSafe(data.prompt ?? "", 120);
      const r = await checkpoint(c, { note: `Before agent turn: ${clip(data.prompt ?? "")}`, trigger: "claude-code:prompt", agent: claude(prompt), skipIfUnchanged: true });
      writeFileSync(join(p.store, TURN_FILE), JSON.stringify({ prompt }) + "\n");
      return { event, exitCode: 0, checkpoint: r.skipped ? null : r.checkpoint.id, verdict: null, message: "" };
    }
    if (event === "pre-bash") {
      const command = data.tool_input?.command ?? "";
      if (!isRisky(command)) return none(event);
      const r = await checkpoint(c, { note: `Before risky command: ${clip(command)}`, trigger: "claude-code:pre-bash", agent: claude(turnPrompt(p)), skipIfUnchanged: true });
      return { event, exitCode: 0, checkpoint: r.checkpoint.id, verdict: null, message: "" };
    }
    // stop: save, check, and compare with the newest earlier verdict.
    audit(p, "agent-turn", null, "ended");
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
      if (data.stop_hook_active) return { event, exitCode: 0, checkpoint: id, verdict: v.verdict, message };
      return { event, exitCode: 2, checkpoint: id, verdict: v.verdict, message };
    }
    return { event, exitCode: 0, checkpoint: id, verdict: v.verdict, message: "" };
  } catch (e) {
    return none(event, `Time Machine hook skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
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

/** Adds the hooks to .claude/settings.json in the project, keeping everything already there. */
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
    const groups = hooks[w.event] ?? [];
    const exists = groups.some((g) => g.hooks.some((h) => h.command === w.entry.command));
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

export interface HookStatusResult {
  settingsPath: string;
  /** False when the file exists but is not plain JSON in the expected shape. Nothing was changed. */
  readable: boolean;
  /** Hook events that already run this command. */
  present: string[];
  missing: string[];
}

/** Reads .claude/settings.json and says which of our lines are there. Never writes. */
export async function hookStatus(ctx: Ctx, opts: { command: string }): Promise<HookStatusResult> {
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
      return { settingsPath, readable: false, present: [], missing: wanted.map((w) => w.event) };
    }
  }
  const present = wanted.filter((w) => (settings.hooks?.[w.event] ?? []).some((g) => g.hooks.some((h) => h.command === w.entry.command))).map((w) => w.event);
  return { settingsPath, readable: true, present, missing: wanted.map((w) => w.event).filter((e) => !present.includes(e)) };
}
