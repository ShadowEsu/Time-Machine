// The narrow bridge between the window and the engine. The main process validates every
// call with these schemas before it touches the engine. The preview build fakes this API.
import { z } from "zod";
import type {
  CheckpointResult,
  CleanStoreResult,
  DemoResult,
  DiffResult,
  FindGoodResult,
  HookInstallResult,
  HookState,
  InitResult,
  LogResult,
  OpenResult,
  RecoverResult,
  SetCheckResult,
  TimelineResult,
  UndoRecoverResult,
  Verdict,
  VerifyResult,
} from "@timetm/core";

export type { Verdict };

export const ProjectId = z.string().uuid();
export const CheckpointId = z.string().regex(/^cp-\d{4,}$/);
const Note = z.string().max(200);
const CheckCommand = z.string().trim().min(1).max(500).refine((s) => !/[\r\n\0]/.test(s), "one line only");
const AbsPath = z.string().min(1).max(4096).refine((s) => s.startsWith("/") || /^[A-Za-z]:\\/.test(s), "must be an absolute path");

export const ThemeSchema = z.enum(["system", "light", "dark"]);

const MODIFIERS = new Set(["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "Shift", "Super", "Meta"]);
/** Modifiers that make a key a command rather than typing. Without one, Option and Shift type characters. */
const COMMAND_MODIFIERS = new Set(["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Super", "Meta"]);
/** Copy, paste, cut, undo, quit, close and select all stay with the app in front, with any extra modifier. */
const RESERVED_KEYS = new Set(["C", "V", "X", "Z", "Q", "W", "A"]);
const HOTKEY_KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Backspace|Delete|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Plus|[,./;'[\]\\`=-])$/;

/**
 * A global shortcut in Electron accelerator form, such as Control+Alt+T. Two modifiers, one
 * of them Control or Command, so it can't swallow typing, and never a key other apps rely on.
 */
export const HotkeySchema = z
  .string()
  .max(60)
  .refine((s) => {
    const parts = s.split("+");
    const key = parts.pop() ?? "";
    return (
      HOTKEY_KEY.test(key) &&
      parts.length >= 2 &&
      parts.every((m) => MODIFIERS.has(m)) &&
      new Set(parts).size === parts.length &&
      parts.some((m) => COMMAND_MODIFIERS.has(m)) &&
      !RESERVED_KEYS.has(key)
    );
  }, "Use two modifier keys, one of them Control or Command, and one key, like Control+Alt+T. Copy, paste, cut, undo, quit, close and select all are kept for other apps.");

export const DEFAULT_HOTKEY = "Control+Alt+T";

export const SettingsSchema = z.strictObject({
  showGitDetails: z.boolean().default(false),
  overlayCards: z.boolean().default(true),
  theme: ThemeSchema.default("system"),
  onboarded: z.boolean().default(false),
  /** Use the plain step by step sheet instead of the Time View. Reduce motion turns it on by itself. */
  simpleRewind: z.boolean().default(false),
  /** Shows the app window from any app. Null turns it off. */
  hotkey: HotkeySchema.nullable().default(DEFAULT_HOTKEY),
  /** The small "Claude Code is working" pill while an agent turn is in progress. */
  agentPill: z.boolean().default(true),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A change to some settings. No defaults here, so a patch never resets what it leaves out. */
export const SettingsPatchSchema = z.strictObject({
  showGitDetails: z.boolean().optional(),
  overlayCards: z.boolean().optional(),
  theme: ThemeSchema.optional(),
  onboarded: z.boolean().optional(),
  simpleRewind: z.boolean().optional(),
  hotkey: HotkeySchema.nullable().optional(),
  agentPill: z.boolean().optional(),
});

export const ProjectEntrySchema = z.strictObject({
  id: ProjectId,
  path: AbsPath,
  name: z.string().min(1).max(200),
  addedAt: z.string(),
  demo: z.boolean().default(false),
});
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

/** Every call the window can make. One schema per method. */
export const CallSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("bootstrap") }),
  z.strictObject({ method: z.literal("chooseFolder") }),
  z.strictObject({ method: z.literal("addProject"), path: AbsPath }),
  z.strictObject({ method: z.literal("removeProject"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("statuses") }),
  z.strictObject({ method: z.literal("init"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("setCheck"), projectId: ProjectId, command: CheckCommand }),
  z.strictObject({ method: z.literal("checkpoint"), projectId: ProjectId, note: Note.optional(), ifChanged: z.boolean().optional() }),
  z.strictObject({ method: z.literal("timeline"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("diff"), projectId: ProjectId, a: CheckpointId, b: CheckpointId }),
  z.strictObject({ method: z.literal("open"), projectId: ProjectId, id: CheckpointId }),
  z.strictObject({ method: z.literal("verify"), projectId: ProjectId, id: CheckpointId }),
  z.strictObject({ method: z.literal("findGood"), projectId: ProjectId }),
  z.strictObject({ method: z.literal("recover"), projectId: ProjectId, id: CheckpointId }),
  z.strictObject({ method: z.literal("undoRecover"), projectId: ProjectId, id: CheckpointId, branch: z.string().regex(/^tm\/recover\/cp-\d{4,}(-\d+)?$/), copyDir: AbsPath }),
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
  z.strictObject({ method: z.literal("reveal"), path: AbsPath }),
  z.strictObject({ method: z.literal("readReport"), path: AbsPath }),
  z.strictObject({ method: z.literal("copy"), text: z.string().max(200_000) }),
  z.strictObject({ method: z.literal("setActive"), projectId: ProjectId }),
]);
export type Call = z.infer<typeof CallSchema>;
export type Method = Call["method"];

export interface ProjectStatus {
  projectId: string;
  /** Null when the project has no save points yet. */
  newest: { id: string; verdict: Verdict | null } | null;
  lastWorking: { id: string; createdAt: string; note: string } | null;
  /** Set when the engine could not read the project (moved, not Git, and so on). */
  problem: string | null;
}

export interface Bootstrap {
  platform: string;
  settings: Settings;
  projects: ProjectEntry[];
  /** The shortcut that shows the app window. Empty when it is off. */
  hotkey: string;
  /** False when the shortcut is set but another app already owns it. */
  hotkeyActive: boolean;
  storeDir: string;
  preview: boolean;
}

export interface HookPreview {
  settingsPath: string;
  command: string;
  /** True when `command --version` answered with this version on this Mac. Nothing is added when false. */
  runs: boolean;
  lines: { event: string; command: string }[];
}

export interface StorageRow {
  projectId: string;
  name: string;
  bytes: number;
  storeDir: string;
}

/** Claude Code hook lines in one project's .claude/settings.json. */
export interface AgentRow {
  projectId: string;
  name: string;
  /** "partial": some of our three lines are there. "not-running": our lines are there, but the command did not answer. "unreadable": the file is not plain JSON, so it was left alone. "unavailable": the project could not be read. */
  claudeCode: HookState | "unavailable";
  settingsPath: string | null;
  /** Hook events still missing: UserPromptSubmit, PreToolUse, Stop. */
  missing: string[];
  /** True from the prompt hook until the stop hook, for at most an hour. */
  working: boolean;
  workingSince: string | null;
}

export interface IsolationInfo {
  /** The only mode implemented. Checks run in a separate Git worktree on this Mac. */
  mode: "host";
  /** What blocks the network during checks when a project asks for it, or null when nothing on this Mac can. */
  networkSandbox: string | null;
}

/** What each method returns. */
export interface Results {
  bootstrap: Bootstrap;
  chooseFolder: string | null;
  addProject: ProjectEntry;
  removeProject: ProjectEntry[];
  statuses: ProjectStatus[];
  init: InitResult;
  setCheck: SetCheckResult;
  checkpoint: CheckpointResult;
  timeline: TimelineResult;
  diff: DiffResult;
  open: OpenResult;
  verify: VerifyResult;
  findGood: FindGoodResult;
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
  reveal: true;
  readReport: string;
  copy: true;
  setActive: true;
}

export interface ApiError {
  kind: string;
  message: string;
}

export type Res<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type CallOf<M extends Method> = Extract<Call, { method: M }>;

/** Things the main process tells the window. */
export type AppEvent =
  | { type: "navigate"; projectId: string; screen: "rewind" | "compare" | "history"; target?: string; a?: string; b?: string }
  | { type: "progress"; projectId: string; checkpoint: string; verdict: string }
  | { type: "changed"; projectId: string }
  | { type: "settings"; settings: Settings }
  | { type: "shortcut"; action: ShortcutAction };

export type ShortcutAction = "save" | "check" | "rewind" | "inspector" | "settings" | "add" | "compare";

export interface TmBridge {
  call<M extends Method>(call: CallOf<M>): Promise<Res<Results[M]>>;
  onEvent(cb: (e: AppEvent) => void): () => void;
}

// Overlay window

export type OverlayAction =
  | { kind: "rewind"; projectId: string; target: string }
  | { kind: "compare"; projectId: string; a: string; b: string }
  | { kind: "history"; projectId: string; target?: string }
  | { kind: "dismiss" };

export const OverlayActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("rewind"), projectId: ProjectId, target: CheckpointId }),
  z.strictObject({ kind: z.literal("compare"), projectId: ProjectId, a: CheckpointId, b: CheckpointId }),
  z.strictObject({ kind: z.literal("history"), projectId: ProjectId, target: CheckpointId.optional() }),
  z.strictObject({ kind: z.literal("dismiss") }),
]);

export interface CardButton {
  label: string;
  action: OverlayAction;
}

export type OverlayContent =
  | {
      kind: "card";
      /** The verdict the card rests on. Null for cards that are not about a check. */
      verdict: Verdict | null;
      projectName: string;
      title: string;
      body: string;
      primary: CardButton | null;
      secondary: CardButton | null;
      /** Milliseconds before it hides on its own, unless hovered. */
      hideAfterMs: number;
    }
  | {
      kind: "strip";
      projectId: string;
      projectName: string;
      points: { id: string; verdict: Verdict | null; note: string; createdAt: string }[];
      hideAfterMs: number;
    }
  | {
      /** Shown only while an agent turn is in progress. It never hides on a timer. */
      kind: "pill";
      projectId: string;
      projectName: string;
      agent: string;
    };

export interface OverlayBridge {
  onContent(cb: (c: OverlayContent) => void): void;
  act(a: OverlayAction): void;
  hover(on: boolean): void;
}
