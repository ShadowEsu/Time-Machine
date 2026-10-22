import type { Verdict } from "./verdict.js";

/** Where the engine runs. Every command takes one. */
export interface Ctx {
  cwd: string;
  /** Store root. Defaults to $TM_HOME, then ~/.timemachine. */
  tmHome?: string;
  env?: NodeJS.ProcessEnv;
}

export interface Coverage {
  captured: string[];
  restorable: string[];
  missing: string[];
  manual: string[];
}

/** The agent that made a save point. The prompt is clipped and never holds secret looking text. */
export interface AgentInfo {
  name: string;
  prompt?: string;
}

export interface CheckpointSummary {
  id: string;
  createdAt: string;
  note: string;
  trigger: string;
  /** Null when a person made it (the app, the CLI) or for save points made before this was recorded. */
  agent: AgentInfo | null;
  /** The save point itself, as a Git commit. Equals `head` when no tracked file had uncommitted changes. */
  commit: string;
  /** The project's Git HEAD commit when the save point was made. Null before the first commit. */
  head: string | null;
  branch: string | null;
  dirty: boolean;
  files: number;
  coverage: Coverage;
}

export interface VerdictRecord {
  at: string;
  checkpoint: string;
  verdict: Verdict;
  isolation: "host";
  network: { policy: "allow" | "deny"; enforcedBy: string | null };
  command: string;
  durationMs: number;
  exitCode: number | null;
  reason: string;
  log: string | null;
}

export interface InitResult {
  configPath: string;
  created: boolean;
  verifyCommand: string;
  /** Install step that runs before the check in the fresh copy. "" when none. */
  verifySetup: string;
  network: "allow" | "deny";
  sandbox: string | null;
  /** The command this computer trusts the Claude Code plugin and MCP tools to run (setup, then the check), or null when it is not approved (tm init --no-approve). */
  approvedCheck: string | null;
}

export interface SetCheckResult {
  configPath: string;
  verifyCommand: string;
}

export interface CheckpointResult {
  checkpoint: CheckpointSummary;
  /** True when nothing changed and the newest checkpoint was returned instead. */
  skipped: boolean;
}

export interface TimelineEntry extends CheckpointSummary {
  verdict: Verdict | null;
  isolation: "host" | null;
}

export interface TimelineResult {
  project: string;
  checkpoints: TimelineEntry[];
}

export interface DiffResult {
  a: string;
  b: string;
  code: { path: string; status: string }[];
  files: { added: string[]; removed: string[]; changed: string[] };
  config: { added: string[]; removed: string[]; changed: string[] };
  dependencies: { changed: string[] };
  environment: { changed: string[] };
}

export interface OpenResult {
  id: string;
  dir: string;
  isolation: "host";
  restored: string[];
  missing: string[];
  manual: string[];
}

/** `stopped` is set when the user stopped the check. Such a result is never recorded as the save point's verdict. */
export type VerifyResult = VerdictRecord & { stopped?: true };

export interface FindGoodResult {
  verdict: Verdict;
  found: string | null;
  tried: { id: string; verdict: Verdict; reason: string }[];
  /** Set when the user stopped the search before it found a version that passes. */
  stopped?: true;
}

export interface RecoverResult {
  id: string;
  branch: string;
  copyDir: string;
  savedBefore: string;
  reportPath: string;
  lastVerdict: Verdict | null;
  restored: string[];
  notRestored: string[];
  manualSteps: string[];
  pushed: false;
}

/** What undoing a recovery removed. Save points are never removed, including the one made before the recovery. */
export interface UndoRecoverResult {
  id: string;
  removedBranch: string;
  /** Null when the recovery copy was already gone. */
  removedCopy: string | null;
}

export interface AuditEntry {
  at: string;
  action: string;
  target: string | null;
  result: string;
}

export interface LogResult {
  entries: AuditEntry[];
}

export type HookEvent = "prompt" | "pre-bash" | "stop";

export interface HookResult {
  event: HookEvent;
  exitCode: 0 | 2;
  checkpoint: string | null;
  verdict: Verdict | null;
  message: string;
  /** Shown to the user, never to Claude: the CLI prints it as Claude Code hook JSON `{"systemMessage": ...}` on stdout. */
  systemMessage?: string;
}

export interface HookInstallResult {
  settingsPath: string;
  added: string[];
  alreadyPresent: string[];
}

export interface DemoResult {
  dir: string;
  checkpoints: { id: string; note: string; expect: "PASS" | "FAIL" }[];
  findGood: FindGoodResult;
  recover: RecoverResult;
}
