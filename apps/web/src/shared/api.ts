// The narrow bridge between the browser page and the engine. The tm ui server validates every
// call with these schemas before it touches the engine. The preview build fakes this API.
import { z } from "zod";
import { EXTERNAL_REFUSED, isAllowedExternal } from "./links.js";
import type {
  CheckpointResult,
  CleanStoreResult,
  DemoResult,
  DiffResult,
  FindGoodResult,
  HookInstallResult,
  HookState,
  InitResult,
  LicenseStatus,
  LogResult,
  LogTail,
  OpenResult,
  RecoverResult,
  RunNote,
  SetCheckResult,
  SourceId,
  SourceRow,
  ThinPreview,
  TimelineResult,
  UndoRecoverResult,
  Verdict,
  VerdictRecord,
  VerifyResult,
} from "@timetm/core";

export type { LicenseStatus, LogTail, RunNote, SourceId, SourceRow, ThinPreview, Verdict, VerdictRecord };

export const ProjectId = z.string().uuid();
export const CheckpointId = z.string().regex(/^cp-\d{4,}$/);
const Note = z.string().max(200);
const CheckCommand = z.string().trim().min(1).max(500).refine((s) => !/[\r\n\0]/.test(s), "one line only");
const AbsPath = z.string().min(1).max(4096).refine((s) => s.startsWith("/") || /^[A-Za-z]:\\/.test(s), "must be an absolute path");

export const ThemeSchema = z.enum(["system", "light", "dark"]);

/**
 * Settings kept in settings.json. Unknown keys are dropped, not refused: a file written by an older
 * version (with the Mac app's hotkey or overlay keys) still loads and keeps its theme.
 */
export const SettingsSchema = z.object({
  showGitDetails: z.boolean().default(false),
  /** New installs follow the system, light first. A saved choice, including Dark or Light, is kept. */
  theme: ThemeSchema.default("system"),
  onboarded: z.boolean().default(false),
  /** Use the plain step by step sheet instead of the Time View. Reduce motion turns it on by itself. */
  simpleRewind: z.boolean().default(false),
  /** The one-time tip that explains the verdict words, shown with the first verdict until it is hidden. */
  verdictTipSeen: z.boolean().default(false),
  /** Projects whose setup strip on History was hidden with Hide, after their first verdict. */
  setupHidden: z.array(ProjectId).max(1000).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A change to some settings. No defaults here, so a patch never resets what it leaves out. */
export const SettingsPatchSchema = z.strictObject({
  showGitDetails: z.boolean().optional(),
  theme: ThemeSchema.optional(),
  onboarded: z.boolean().optional(),
  simpleRewind: z.boolean().optional(),
  verdictTipSeen: z.boolean().optional(),
  setupHidden: z.array(ProjectId).max(1000).optional(),
});

/** A Vercel project linked to a Time Machine project. The ids go into API URLs, so only safe characters. */
export const VercelLinkSchema = z.strictObject({
  teamId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).nullable(),
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  name: z.string().min(1).max(200),
});
export type VercelLink = z.infer<typeof VercelLinkSchema>;

export const AutoSaveSchema = z.enum(["off", "change"]);
export type AutoSave = z.infer<typeof AutoSaveSchema>;

/** Opt-in features per project. Each is off until the person turns it on, except auto save for new plain folders. */
export const FeaturesSchema = z.strictObject({
  /** Ask about your history: sends a summary of the history to Google's Gemini API. */
  ask: z.boolean().default(false),
  /** The Vercel project whose deploys show on the timeline. Null when none is linked. */
  vercel: VercelLinkSchema.nullable().default(null),
  /**
   * "change": save when files change, while Time Machine is open (after 20 s of quiet, at most once a
   * minute). New plain folders for documents, research or agents start with "change"; everything else "off".
   */
  autoSave: AutoSaveSchema.default("off"),
});
export type Features = z.infer<typeof FeaturesSchema>;

/** "folder" is a plain folder: its history lives in a shadow Git dir in the store. Nothing is written in the folder. */
export const ProjectKindSchema = z.enum(["git", "folder"]);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;
/** What the person keeps in the project. Only changes words and defaults in the app, never what is saved. */
export const PurposeSchema = z.enum(["code", "documents", "research", "agents", "other"]);
export type Purpose = z.infer<typeof PurposeSchema>;

export const ProjectEntrySchema = z.strictObject({
  id: ProjectId,
  path: AbsPath,
  name: z.string().min(1).max(200),
  addedAt: z.string(),
  demo: z.boolean().default(false),
  /** Missing in files from before these features existed. They load with everything off. */
  features: FeaturesSchema.prefault({}),
  /** Missing in files from before plain folders: those were all Git projects. */
  kind: ProjectKindSchema.default("git"),
  /** Missing in files from before purposes: those were all code projects. */
  purpose: PurposeSchema.default("code"),
});
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

/** Keys the opt-in features use. The window only ever learns whether each one is set. */
export const CredentialNameSchema = z.enum(["gemini", "vercel"]);
export type CredentialName = z.infer<typeof CredentialNameSchema>;
/** An API key or token: printable characters, no spaces. */
export const CredentialValueSchema = z.string().trim().min(1).max(4096).regex(/^[\x21-\x7E]+$/, "A key has no spaces or line breaks.");

export const ExternalUrlSchema = z.string().max(2048).refine(isAllowedExternal, EXTERNAL_REFUSED);

const FeatureChange = z.discriminatedUnion("feature", [
  z.strictObject({ feature: z.literal("ask"), enabled: z.boolean() }),
  z.strictObject({ feature: z.literal("vercel"), link: VercelLinkSchema.nullable() }),
  z.strictObject({ feature: z.literal("autoSave"), autoSave: AutoSaveSchema }),
]);
export type FeatureChange = z.infer<typeof FeatureChange>;

/** The same email rule the site uses: one @, no spaces, a dot in the domain. */
const SignInEmail = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]{1,64}@[^\s@.][^\s@]*\.[^\s@]{2,}$/);

/** Every call the window can make. One schema per method. */
export const CallSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("bootstrap") }),
  z.strictObject({ method: z.literal("addProject"), path: AbsPath, purpose: PurposeSchema.optional() }),
  z.strictObject({ method: z.literal("setPurpose"), projectId: ProjectId, purpose: PurposeSchema }),
  z.strictObject({ method: z.literal("notes"), projectId: ProjectId }),
  z.strictObject({
    method: z.literal("setNote"),
    projectId: ProjectId,
    id: CheckpointId,
    title: z.string().trim().max(80).optional(),
    note: z.string().max(2000).optional(),
    pinned: z.boolean().optional(),
  }),
  z.strictObject({ method: z.literal("sources") }),
  z.strictObject({ method: z.literal("thinPreview"), projectId: ProjectId }),
  /** Exactly the ids a preview showed. The engine re-runs the preview and refuses any other. */
  z.strictObject({ method: z.literal("thinApply"), projectId: ProjectId, ids: z.array(CheckpointId).max(100_000) }),
  z.strictObject({ method: z.literal("removeProject"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("statuses") }),
  z.strictObject({ method: z.literal("init"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("setCheck"), projectId: ProjectId, command: CheckCommand }),
  z.strictObject({ method: z.literal("checkpoint"), projectId: ProjectId, note: Note.optional(), ifChanged: z.boolean().optional() }),
  z.strictObject({ method: z.literal("timeline"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("diff"), projectId: ProjectId, a: CheckpointId, b: CheckpointId }),
  z.strictObject({ method: z.literal("open"), projectId: ProjectId, id: CheckpointId }),
  z.strictObject({ method: z.literal("verify"), projectId: ProjectId, id: CheckpointId }),
  /** The end of a save point's newest check log. The engine picks the file by the id; the page never sends a path. */
  z.strictObject({ method: z.literal("checkLogTail"), projectId: ProjectId, id: CheckpointId }),
  /** A save point's newest sealed check record. The engine picks the record by the id and cleans it of secrets. */
  z.strictObject({ method: z.literal("checkRecord"), projectId: ProjectId, id: CheckpointId }),
  z.strictObject({ method: z.literal("findGood"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("stopCheck"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("recover"), projectId: ProjectId, id: CheckpointId }),
  /** `branch` is "" for a plain folder project: its recovery made a copy only. */
  z.strictObject({ method: z.literal("undoRecover"), projectId: ProjectId, id: CheckpointId, branch: z.string().regex(/^(tm\/recover\/cp-\d{4,}(-\d+)?)?$/), copyDir: AbsPath }),
  z.strictObject({ method: z.literal("log"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("hookPreview"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("hookInstall"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("demo") }),
  z.strictObject({ method: z.literal("storage") }),
  z
    .strictObject({
      method: z.literal("cleanStore"),
      projectId: ProjectId,
      apply: z.boolean(),
      /** When applying: exactly the files the preview showed. Only these can be removed. */
      files: z.array(z.string().max(300).regex(/^logs\/(?!\.\.?$)[^/\\]+$/)).max(100_000).optional(),
    })
    .refine((c) => !c.apply || c.files !== undefined, "Removing needs the list of files the preview showed."),
  z.strictObject({ method: z.literal("agents") }),
  z.strictObject({ method: z.literal("isolation") }),
  z.strictObject({ method: z.literal("setSettings"), patch: SettingsPatchSchema }),
  z.strictObject({ method: z.literal("readReport"), path: AbsPath }),
  z.strictObject({ method: z.literal("copy"), text: z.string().max(200_000) }),
  z.strictObject({ method: z.literal("setActive"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("openExternal"), url: ExternalUrlSchema }),
  z.strictObject({ method: z.literal("setFeature"), projectId: ProjectId, change: FeatureChange }),
  z.strictObject({ method: z.literal("credentials") }),
  z.strictObject({ method: z.literal("setCredential"), name: CredentialNameSchema, value: CredentialValueSchema.nullable() }),
  z.strictObject({ method: z.literal("ask"), projectId: ProjectId, question: z.string().trim().min(1).max(500) }),
  z.strictObject({ method: z.literal("vercelProjects") }),
  z.strictObject({ method: z.literal("deployments"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("license") }),
  /** A pasted key. Verified offline by the engine; never logged. */
  z.strictObject({ method: z.literal("setLicense"), key: z.string().trim().min(10).max(4000) }),
  z.strictObject({ method: z.literal("removeLicense") }),
  /** What the Time Machine site has open: buying and sign-in. */
  z.strictObject({ method: z.literal("siteStatus") }),
  /** Emails a six digit sign-in code. The email goes to the site only; the app keeps nothing. */
  z.strictObject({ method: z.literal("signIn"), email: SignInEmail }),
  /** Trades the code for a sign-in token that the server keeps in memory only. */
  z.strictObject({ method: z.literal("verifyCode"), email: SignInEmail, code: z.string().regex(/^\d{6}$/) }),
  z.strictObject({ method: z.literal("accountLicenses") }),
  /** Forgets the sign-in token. Nothing is sent to the site. */
  z.strictObject({ method: z.literal("signOut") }),
]);
export type Call = z.infer<typeof CallSchema>;
export type Method = Call["method"];

export interface ProjectStatus {
  projectId: string;
  /** Null when the project has no save points yet. */
  newest: { id: string; verdict: Verdict | null; createdAt: string } | null;
  lastWorking: { id: string; createdAt: string; note: string } | null;
  /** Set when the engine could not read the project (moved, not Git, and so on). */
  problem: string | null;
}

export interface Bootstrap {
  /** True only for a private local preview that bundled the provider marks. Public builds never set it. */
  localBrandMarks?: boolean;
  platform: string;
  settings: Settings;
  projects: ProjectEntry[];
  /** The one-time license on this computer. The free app lists a few projects; restores are never behind it. */
  license: LicenseStatus;
  storeDir: string;
  preview: boolean;
}

export interface HookPreview {
  settingsPath: string;
  command: string;
  /** True when `command --version` answered with this version on this computer. Nothing is added when false. */
  runs: boolean;
  /** The Time Machine plugin is installed and on in Claude Code for this project, so no lines are needed. */
  plugin: boolean;
  lines: { event: string; command: string }[];
}

export interface StorageRow {
  projectId: string;
  name: string;
  bytes: number;
  storeDir: string;
}

/** How Claude Code reaches Time Machine in one project: our lines in its .claude/settings.json, or the Claude Code plugin. */
export interface AgentRow {
  projectId: string;
  name: string;
  /**
   * "partial": some of our three lines are there. "not-running": the lines or the plugin are there, but tm did not answer.
   * "needs-approval": the plugin covers this project, but this computer has not approved its check, so the plugin does
   * nothing here. "unreadable": the settings file is not plain JSON, so it was left alone. "unavailable": the project
   * could not be read.
   */
  claudeCode: HookState | "needs-approval" | "unavailable";
  /** Where the connection comes from. Project lines win: the plugin steps aside where they exist. */
  via: "settings" | "plugin" | null;
  /** The plugin is installed for this project but turned off in enabledPlugins. */
  pluginOff: boolean;
  /** The check the plugin would run, shown before anyone approves it. Null without a check. */
  check: string | null;
  settingsPath: string | null;
  /** Hook events still missing: UserPromptSubmit, PreToolUse, Stop. */
  missing: string[];
  /** True from the prompt hook until the stop hook, for at most an hour. */
  working: boolean;
  workingSince: string | null;
}

export interface IsolationInfo {
  /** The only mode implemented. Checks run in a separate Git worktree on this computer. */
  mode: "host";
  /** What blocks the network during checks when a project asks for it, or null when nothing on this computer can. */
  networkSandbox: string | null;
}

/** An answer from Ask about your history. */
export interface AskResult {
  /** Plain sentences, based only on the history that was sent. */
  answer: string;
  /** Save points the answer relies on, oldest first. Only ids that were in the history sent. */
  cites: string[];
  /** How many save points were sent with the question. */
  basis: number;
}

/** A Vercel project the token can see, for linking one. */
export interface VercelProjectOption {
  /** Null for a personal project outside any team. */
  teamId: string | null;
  teamName: string | null;
  projectId: string;
  name: string;
  /** The connected Git repository, such as acme/marigold-tips, when Vercel reports one. */
  repo: string | null;
}

/** One Vercel deploy, read only. */
export interface VercelDeployment {
  id: string;
  /** Null while the upload is not finished. */
  url: string | null;
  /** "other" is a custom environment, such as staging. */
  target: "production" | "preview" | "other";
  state: "BLOCKED" | "BUILDING" | "CANCELED" | "DELETED" | "ERROR" | "INITIALIZING" | "QUEUED" | "READY";
  createdAt: string;
  /** The Vercel username that made it. */
  creator: string | null;
  /** How it was made, as Vercel reports it, such as "git" or "cli". */
  source: string | null;
  /** The Git commit it was built from. Null when Vercel has none, as for most deploys from a computer. */
  commit: string | null;
  branch: string | null;
  /** True when Vercel reports the folder had uncommitted changes. */
  dirty: boolean;
  inspectorUrl: string | null;
}

/** A project's recent deploys, placed by commit. Never matched by time. */
export interface DeploymentsResult {
  link: VercelLink;
  /** Deploys whose commit is the recorded Git HEAD of one or more save points. Exact means the save point held nothing beyond that commit. */
  matched: { deployment: VercelDeployment; savePoints: { id: string; exact: boolean }[] }[];
  /** Deploys of a commit no save point recorded. */
  otherCommits: VercelDeployment[];
  /** Deploys with no Git commit, for example from the Vercel CLI: not linked to a save point. */
  noCommit: VercelDeployment[];
  fetchedAt: string;
}

/** What the Time Machine site has open, from its /api/health. */
export interface SiteStatus {
  checkout: boolean;
  auth: boolean;
}

/** The keys bought with the signed-in email, as the site lists them. */
export interface AccountLicenses {
  email: string;
  licenses: { key: string; id: string; issued: string }[];
}

/** What each method returns. */
export interface Results {
  bootstrap: Bootstrap;
  addProject: ProjectEntry;
  setPurpose: ProjectEntry;
  /** Keyed by save point id. Save points with no note are left out. */
  notes: Record<string, RunNote>;
  setNote: RunNote;
  sources: SourceRow[];
  thinPreview: ThinPreview;
  thinApply: { removed: number };
  removeProject: ProjectEntry[];
  statuses: ProjectStatus[];
  init: InitResult;
  setCheck: SetCheckResult;
  checkpoint: CheckpointResult;
  timeline: TimelineResult;
  diff: DiffResult;
  open: OpenResult;
  verify: VerifyResult;
  /** Null when the save point has no stored check log. Shown and copied only; never sent to Ask, a report or an export. */
  checkLogTail: LogTail | null;
  /** Null when the save point has no valid stored record. Shown in the detail and Inspector only; never sent to Ask, a report or an export. */
  checkRecord: VerdictRecord | null;
  findGood: FindGoodResult;
  /** True when a running check or search was stopped. */
  stopCheck: boolean;
  recover: RecoverResult;
  undoRecover: UndoRecoverResult;
  log: LogResult;
  hookPreview: HookPreview;
  hookInstall: HookInstallResult;
  demo: { project: ProjectEntry; result: DemoResult };
  storage: StorageRow[];
  cleanStore: CleanStoreResult;
  agents: AgentRow[];
  isolation: IsolationInfo;
  setSettings: Settings;
  readReport: string;
  copy: true;
  setActive: true;
  openExternal: true;
  setFeature: ProjectEntry;
  credentials: Record<CredentialName, boolean>;
  setCredential: { configured: boolean };
  ask: AskResult;
  vercelProjects: VercelProjectOption[];
  /** Null when the project is not linked to a Vercel project. */
  deployments: DeploymentsResult | null;
  license: LicenseStatus;
  setLicense: LicenseStatus;
  removeLicense: LicenseStatus;
  siteStatus: SiteStatus;
  signIn: { ok: true };
  verifyCode: { ok: true };
  /** Null when signed out, or when the sign-in ended. */
  accountLicenses: AccountLicenses | null;
  signOut: { ok: true };
}

export interface ApiError {
  kind: string;
  message: string;
}

export type Res<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type CallOf<M extends Method> = Extract<Call, { method: M }>;

/** Things the server tells the page. */
export type AppEvent =
  | { type: "navigate"; projectId: string; screen: "rewind" | "compare" | "history"; target?: string; a?: string; b?: string }
  | { type: "progress"; projectId: string; checkpoint: string; verdict: string }
  | { type: "changed"; projectId: string }
  | { type: "settings"; settings: Settings }
  | { type: "license"; license: LicenseStatus };

export interface TmBridge {
  call<M extends Method>(call: CallOf<M>): Promise<Res<Results[M]>>;
  onEvent(cb: (e: AppEvent) => void): () => void;
}
