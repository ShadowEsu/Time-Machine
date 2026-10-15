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

export interface CheckpointSummary {
  id: string;
  createdAt: string;
  note: string;
  trigger: string;
  commit: string;
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
  network: "allow" | "deny";
  sandbox: string | null;
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

export type VerifyResult = VerdictRecord;

export interface FindGoodResult {
  verdict: Verdict;
  found: string | null;
  tried: { id: string; verdict: Verdict; reason: string }[];
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
