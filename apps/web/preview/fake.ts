// An in-memory stand-in for the engine, used only by the browser preview. It replays the
// Marigold Tips demo story: six save points, cp-0004 broke it, find-good lands on cp-0003.
// All data is synthetic. The real app calls @timetm/core instead.
import type { DiffResult, FindGoodResult, ForgetResult, RecoverResult, RestoreResult, TimelineEntry, UndoRecoverResult, VerifyResult } from "@timetm/core";
import { AGREE_FIRST, AGREEMENT_OUTDATED, BOX_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "../src/shared/agreement.js";
import { VERCEL_CONSENT_VERSION, vercelConsentValid, type AppEvent, type AskResult, type Call, type CallOf, type CredentialName, type DeploymentsResult, type FeatureChange, type Features, type LicenseStatus, type Method, type ProjectCheckConfig, type ProjectEntry, type ProjectStatus, type Res, type Results, type RunNote, type Settings, type SourceRow, type ThinPreview, type TmBridge, type VercelDeployment, type Verdict } from "../src/shared/api.js";
import { ASK_CONSENT_VERSION, ASK_EXAMPLES, askConsentValid, type AskProvider } from "../src/shared/ask.js";
import { clock } from "../src/shared/format.js";
import { EXTERNAL_REFUSED, isAllowedExternal } from "../src/shared/links.js";
import { looksSecret, NOTE_LOOKS_SECRET } from "../../../packages/core/src/secret-patterns.js";

type FileMap = Record<string, string>;

interface Point {
  entry: TimelineEntry;
  tracked: FileMap;
  untracked: FileMap;
  lockfiles: FileMap;
}

const ROOT = "/Users/you/code/marigold-tips";
const PROJECT_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const NOT_CAPTURED = "Databases, deployed versions and external services are not captured";
const SECRETS = "Secret values in .env: PORT, STRIPE_SECRET_KEY";
const ENV_LINE = "Environment: platform darwin-arm64, node v24.9.0, git 2.50.1";

/** A time this many minutes ago, so the story always reads as "earlier today". */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function hash(s: string): string {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return (h.toString(16).padStart(8, "0") + "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678").slice(0, 40);
}

function makePoint(n: number, note: string, time: string, trigger: string, tracked: FileMap, untracked: FileMap, lockfiles: FileMap, prompt?: string): Point {
  const id = `cp-${String(n).padStart(4, "0")}`;
  const commit = hash(`${id}${JSON.stringify(tracked)}`);
  const files = Object.keys(untracked).length;
  const captured = [`Code: commit ${commit.slice(0, 7)} on main`];
  if (files) captured.push(`Files: ${files} file${files === 1 ? "" : "s"} not in Git`);
  captured.push("Config: 2 keys in .env (0 saved, 2 name only)");
  if (Object.keys(lockfiles).length) captured.push(`Dependencies: ${Object.keys(lockfiles).join(", ")}`);
  captured.push(ENV_LINE);
  return {
    entry: {
      id, createdAt: time, note, trigger, commit, head: commit, branch: "main", dirty: files > 0, files,
      agent: trigger.startsWith("claude-code") ? { name: "Claude Code", ...(prompt ? { prompt } : {}) } : null,
      coverage: { captured, restorable: ["Code", ...(files ? [`${files} saved file${files === 1 ? "" : "s"}`] : [])], missing: [], manual: [SECRETS, NOT_CAPTURED] },
      verdict: null, isolation: null,
    },
    tracked, untracked, lockfiles,
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Which story the preview tells. "broken" is the demo story. The others are for walkthroughs and screenshots. */
export type Scenario = "broken" | "works" | "unchecked" | "new";

/**
 * The opt-in features in the preview. "off" is a fresh install. "on" has Ask turned on and a Vercel
 * project linked. "ask-off" has a Gemini key but Ask off. "no-key" has no Gemini key. "ask-error"
 * has Ask on but Gemini unreachable. "no-vercel" has no Vercel token and nothing linked.
 * "ask-claude" has only an Anthropic key and Ask off. "ask-stale" had Ask turned on for Gemini, and
 * now only an Anthropic key is set, so Ask is paused until the person agrees again.
 */
export type FeatureStory = "off" | "on" | "ask-off" | "no-key" | "ask-error" | "no-vercel" | "ask-claude" | "ask-stale";

const SCENARIOS: readonly Scenario[] = ["broken", "works", "unchecked", "new"];
const FEATURE_STORIES: readonly FeatureStory[] = ["ask-off", "no-key", "ask-error", "no-vercel", "ask-claude", "ask-stale"];

/**
 * The preview story for a ?state= value. ?state=works, unchecked or new tell a different story with
 * the features on. ?state=ask-off, no-key, ask-error, no-vercel, ask-claude or ask-stale tell the demo story with the
 * features in that state. With no value it is the demo story with the features on.
 */
export function previewStory(state: string | null): { scenario: Scenario; features: FeatureStory } {
  return {
    scenario: SCENARIOS.find((s) => s === state) ?? "broken",
    features: FEATURE_STORIES.find((s) => s === state) ?? "on",
  };
}

const PREVIEW_LINK = { teamId: "team_preview", projectId: "prj_marigold", name: "marigold-tips" } as const;

const THESIS_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e1b";
const TRIAL_ID = "4b6d8fa1-2c3e-4a7b-9d1f-3e5a7b9d1f2c";
const FOLDER_MANUAL = "Files over 5 MB and files that look secret are not saved";

/** A small project beside the demo: a plain folder of notes, or a research repo. All data is synthetic. */
interface SideStory {
  project: ProjectEntry;
  points: Point[];
  /** Null when no check is set. A check is optional for folders. */
  check: string | null;
  passes: (files: FileMap) => boolean;
  copies: Set<string>;
  audit: { at: string; action: string; target: string | null; result: string }[];
}

/** A save point of a side project. A folder has no repo, so no HEAD and no branch; every file is in the save point. */
function sidePoint(n: number, note: string, time: string, files: FileMap, folder: boolean, trigger = "app"): Point {
  const id = `cp-${String(n).padStart(4, "0")}`;
  const commit = hash(`${id}${JSON.stringify(files)}`);
  const count = Object.keys(files).length;
  const plural = (k: number): string => `${k} file${k === 1 ? "" : "s"}`;
  return {
    entry: {
      id, createdAt: time, note, trigger, commit, head: folder ? null : commit, branch: folder ? null : "main", dirty: false, files: folder ? count : 0, agent: null,
      coverage: folder
        ? { captured: [`Files: ${plural(count)} in the folder`, "Environment: platform darwin-arm64, node v24.9.0, git 2.50.1"], restorable: [`${count} saved file${count === 1 ? "" : "s"}`], missing: [], manual: [FOLDER_MANUAL] }
        : { captured: [`Code: commit ${commit.slice(0, 7)} on main`, "Environment: platform darwin-arm64, python 3.13.1, git 2.50.1"], restorable: ["Code"], missing: [], manual: ["Data outside the project folder is not captured"] },
      verdict: null, isolation: null,
    },
    // Like the engine: a folder's files are saved files beside an empty commit, so a diff lists them under files.
    tracked: folder ? {} : files, untracked: folder ? files : {}, lockfiles: {},
  };
}

/** The next save point number. Never reused, even after old auto saves were thinned. */
function nextNumber(points: Point[]): number {
  return Number(points.at(-1)?.entry.id.slice(3) ?? 0) + 1;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The engine's thinning rule (packages/core/src/thin.ts) on preview data. Only auto saves can go.
 * Working, pinned, named or noted, recovery-linked, the newest 20 and the last 24 hours always stay.
 * Older auto saves keep one per hour for 7 days, then one per day.
 */
function thinPlan(points: Point[], notes: Record<string, RunNote>, audit: SideStory["audit"], now: number): ThinPreview {
  const linked = new Set(audit.filter((e) => e.action === "recover" || e.action === "undo-recover").flatMap((e) => (e.target ? [e.target] : [])));
  const newest = new Set(points.slice(-20).map((p) => p.entry.id));
  const covered = new Set<string>();
  const remove: ThinPreview["remove"] = [];
  for (const { entry } of [...points].reverse()) {
    const at = Date.parse(entry.createdAt);
    const age = now - at;
    const bucket = age <= 7 * DAY_MS ? `hour ${Math.floor(at / HOUR_MS)}` : `day ${Math.floor(at / DAY_MS)}`;
    const stays = entry.trigger !== "auto" || age < DAY_MS || entry.verdict === "PASS" || entry.id in notes || linked.has(entry.id) || newest.has(entry.id);
    if (stays || !covered.has(bucket)) {
      covered.add(bucket);
      continue;
    }
    remove.push({ id: entry.id, at: entry.createdAt, reason: bucket.startsWith("hour") ? "Another save point from the same hour stays." : "Another save point from the same day stays." });
  }
  remove.reverse();
  // About one changed chapter per auto save, compressed.
  return { remove, keep: points.length - remove.length, bytesFreed: remove.length * 18_432, unreadable: [] };
}

function thesisStory(): SideStory {
  const v1 = { "chapters/01-introduction.md": "1", "references.bib": "1" };
  const methods = (k: number): FileMap => ({ ...v1, "chapters/02-methods.md": String(k) });
  const v3 = { ...methods(41), "chapters/02-methods.md": "rewrite", "figures/timeline.png": "1" };
  const v4 = { ...v3, "chapters/01-introduction.md": "2", "references.bib": "2" };
  const v5 = { ...v4, "chapters/03-results.md": "1" };
  const v6 = { ...v5, "chapters/03-results.md": "2" };
  // Auto saves while the app was open, over nine days of writing the methods chapter: two saves
  // 25 minutes apart, every 11 hours. Old enough that thinning has real numbers to show.
  const autos = Array.from({ length: 40 }, (_, k) => sidePoint(k + 2, "Auto save", ago(60 * 24 * 11 - Math.floor(k / 2) * 60 * 11 - (k % 2) * 25), methods(k + 1), true, "auto"));
  const points = [
    sidePoint(1, "Outline and introduction", ago(60 * 24 * 12), v1, true),
    ...autos,
    sidePoint(42, "Methods draft done", ago(60 * 30), methods(41), true),
    sidePoint(43, "Methods rewrite with figure", ago(60 * 5), v3, true),
    sidePoint(44, "Tightened the introduction", ago(41), v4, true),
    // Saved while the app was open, after the folder was quiet for 20 seconds, as the engine does.
    sidePoint(45, "Auto save", ago(18), v5, true, "auto"),
    sidePoint(46, "Auto save", ago(6), v6, true, "auto"),
  ];
  return {
    project: { id: THESIS_ID, path: "/Users/you/Documents/thesis-notes", name: "thesis-notes", addedAt: ago(60 * 24 * 12 + 5), demo: false, features: { ask: false, vercel: null, autoSave: "change" }, kind: "folder", purpose: "documents" },
    points, check: null, passes: () => true, copies: new Set(), audit: points.map((p) => ({ at: p.entry.createdAt, action: "checkpoint", target: p.entry.id, result: "saved" })),
  };
}

function trialStory(): SideStory {
  const v1 = { "analysis/summary.py": "ok", "data/run-01.csv": "1", "notes/protocol.md": "1" };
  const v2 = { ...v1, "data/run-02.csv": "1" };
  const v3 = { ...v2, "analysis/summary.py": "ok", "data/run-03.csv": "1", "notes/protocol.md": "2" };
  const v4 = { ...v3, "analysis/summary.py": "broken", "data/run-04.csv": "1" };
  const points = [
    sidePoint(1, "Run 01, first pass", ago(60 * 50), v1, false),
    sidePoint(2, "Run 02, more samples", ago(60 * 30), v2, false),
    sidePoint(3, "Run 03, seed 42", ago(60 * 9), v3, false),
    sidePoint(4, "Run 04, new summary script", ago(95), v4, false),
  ];
  const story: SideStory = {
    project: { id: TRIAL_ID, path: "/Users/you/research/trial-run-analysis", name: "trial-run-analysis", addedAt: ago(60 * 51), demo: false, features: { ask: false, vercel: null, autoSave: "off" }, kind: "git", purpose: "research" },
    points, check: "python3 analysis/summary.py --check", passes: (f) => f["analysis/summary.py"] === "ok", copies: new Set(),
    audit: points.map((p) => ({ at: p.entry.createdAt, action: "checkpoint", target: p.entry.id, result: "saved" })),
  };
  for (const p of points.slice(0, 3)) p.entry = { ...p.entry, verdict: "PASS", isolation: "host" };
  const last = points[3];
  if (last) last.entry = { ...last.entry, verdict: "FAIL", isolation: "host" };
  return story;
}

/** What the preview reports as found on this computer: iCloud Drive with an Obsidian vault in it, Documents and Desktop. */
const FAKE_SOURCES: SourceRow[] = [
  { id: "icloud", label: "iCloud Drive", path: "/Users/you/Library/Mobile Documents/com~apple~CloudDocs", found: true },
  { id: "dropbox", label: "Dropbox", path: "/Users/you/Dropbox", found: false },
  { id: "gdrive", label: "Google Drive", path: "/Users/you/Library/CloudStorage/GoogleDrive", found: false },
  { id: "onedrive", label: "OneDrive", path: "/Users/you/Library/CloudStorage/OneDrive", found: false },
  { id: "obsidian", label: "Obsidian", path: "/Users/you/Library/Mobile Documents/iCloud~md~obsidian", found: true },
  { id: "documents", label: "Documents", path: "/Users/you/Documents", found: true },
  { id: "desktop", label: "Desktop", path: "/Users/you/Desktop", found: true },
];

/** What the person agreed to when they turned Ask on, as the engine records it. */
const agreed = (provider: AskProvider | null): NonNullable<Features["askConsent"]> => ({ at: ago(1), version: ASK_CONSENT_VERSION, provider });

/** The preview's Vercel project, linked under the current read-only note, as the engine records a link. */
const linked = (): Pick<Features, "vercel" | "vercelConsent"> => ({ vercel: { ...PREVIEW_LINK }, vercelConsent: { at: ago(1), version: VERCEL_CONSENT_VERSION } });

/** A project's features after one setFeature change, as the engine applies it. */
function withFeature(f: Features, c: FeatureChange, provider: AskProvider | null): Features {
  if (c.feature === "ask") return { ...f, ask: c.enabled, ...(c.enabled ? { askConsent: agreed(provider) } : {}) };
  if (c.feature === "vercel") return { ...f, vercel: c.link, ...(c.link ? { vercelConsent: { at: ago(0), version: VERCEL_CONSENT_VERSION } } : {}) };
  return { ...f, autoSave: c.autoSave };
}

function cmpFiles(x: FileMap, y: FileMap): { added: string[]; removed: string[]; changed: string[] } {
  return {
    added: Object.keys(y).filter((k) => !(k in x)),
    removed: Object.keys(x).filter((k) => !(k in y)),
    changed: Object.keys(x).filter((k) => k in y && x[k] !== y[k]),
  };
}

function diffPoints(pa: Point, pb: Point): DiffResult {
  const code = cmpFiles(pa.tracked, pb.tracked);
  const deps = cmpFiles(pa.lockfiles, pb.lockfiles);
  return {
    a: pa.entry.id, b: pb.entry.id,
    code: [...code.added.map((path) => ({ status: "A", path })), ...code.removed.map((path) => ({ status: "D", path })), ...code.changed.map((path) => ({ status: "M", path }))].sort((x, y) => x.path.localeCompare(y.path)),
    files: cmpFiles(pa.untracked, pb.untracked),
    config: { added: [], removed: [], changed: [] },
    dependencies: { changed: [...deps.added, ...deps.removed, ...deps.changed] },
    environment: { changed: [] },
  };
}

function statusOf(projectId: string, points: Point[]): ProjectStatus {
  const newest = points.at(-1)?.entry;
  const working = [...points].reverse().find((p) => p.entry.verdict === "PASS" && p.entry.id !== newest?.id)?.entry;
  return {
    projectId,
    newest: newest ? { id: newest.id, verdict: newest.verdict, createdAt: newest.createdAt } : null,
    lastWorking: working ? { id: working.id, createdAt: working.createdAt, note: working.note } : null,
    problem: null,
    problemKind: null,
  };
}

/** A side project's check record, the shape a real check returns. */
function record(entry: TimelineEntry, command: string, at: string): VerifyResult {
  const pass = entry.verdict === "PASS";
  return {
    at, checkpoint: entry.id, verdict: entry.verdict ?? "FAIL", isolation: "host", network: { policy: "allow", enforcedBy: null },
    command, durationMs: pass ? 1640 : 1810, exitCode: pass ? 0 : 1,
    reason: pass ? "The check passed." : "The check failed with exit code 1.", log: null,
  };
}

/** Like the site's /api/auth: no code without the ticked Terms and Privacy box, at the versions the site checks. */
function agreedLikeTheSite(call: { agreed?: unknown; termsVersion?: unknown; privacyVersion?: unknown; boxVersion?: unknown }): void {
  if (call.agreed !== true) throw new Error(AGREE_FIRST);
  if (call.termsVersion !== TERMS_VERSION || call.privacyVersion !== PRIVACY_VERSION || call.boxVersion !== BOX_VERSION) throw new Error(AGREEMENT_OUTDATED);
}

export class FakeEngine implements TmBridge {
  private listeners = new Set<(e: AppEvent) => void>();
  private points: Point[] = [];
  private audit: { at: string; action: string; target: string | null; result: string }[] = [];
  private branches = new Set<string>();
  /** "new" starts with no project. Adding the sample folder makes this true. */
  private added = true;
  private seed: Point | null = null;
  private stopping = false;
  settings: Settings = { showGitDetails: false, theme: "system", onboarded: true, simpleRewind: false, verdictTipSeen: false, setupHidden: [], reduceMotion: false };
  /** No key in the preview: the free app, as the real engine reports it (core FREE_PROJECT_LIMIT is 3). */
  private readonly license: LicenseStatus = { active: false, id: null, issued: null, problem: null, freeProjectLimit: 3 };
  readonly project: ProjectEntry = { id: PROJECT_ID, path: ROOT, name: "marigold-tips", addedAt: ago(200), demo: true, features: { ask: false, vercel: null, autoSave: "off" }, kind: "git", purpose: "code" };
  /** The projects beside the demo: a plain folder of thesis notes and a research repo. None in the "new" story. */
  private readonly sides: SideStory[];
  /** Run notes per project, keyed by save point id, as the engine keeps them in a sidecar file. */
  private readonly notes = new Map<string, Record<string, RunNote>>();
  /** Whether each key is set. The preview never holds a real key. */
  private credentials: Record<CredentialName, boolean> = { gemini: true, anthropic: false, vercel: true };
  /** The demo's check settings, as Settings shows and changes them. */
  private checkConfig: ProjectCheckConfig = { command: "npm test", setup: "npm ci --prefer-offline --no-audit --no-fund", timeoutSeconds: 600, network: "allow", maxFileMB: 5 };
  /** The email signed in with code 123456, or null. The preview's sign-in is pretend: nothing is sent. */
  private signedIn: string | null = null;
  /** The demo's Claude Code hook lines: in, until Disconnect takes them out (tm forget); Connect puts them back. */
  private claudeConnected = true;

  constructor(readonly scenario: Scenario = "broken", readonly features: FeatureStory = "off") {
    this.reset();
    this.sides = scenario === "new" ? [] : [thesisStory(), trialStory()];
    if (this.sides.length) {
      this.notes.set(TRIAL_ID, { "cp-0003": { title: "Baseline run, seed 42", note: "The reference run. Same data as run 02 with a fixed seed. Compare new runs against this one.", pinned: true, updated: ago(60 * 8) } });
    }
    const off = this.project.features;
    if (features === "on" || features === "ask-error") this.project.features = { ...off, ask: true, askConsent: agreed("gemini"), ...linked() };
    if (features === "ask-off") this.project.features = { ...off, ask: false, ...linked() };
    if (features === "no-key") {
      this.project.features = { ...off, ask: false, ...linked() };
      this.credentials = { ...this.credentials, gemini: false };
    }
    if (features === "no-vercel") {
      this.project.features = { ...off, ask: true, askConsent: agreed("gemini"), vercel: null };
      this.credentials = { ...this.credentials, vercel: false };
    }
    if (features === "ask-claude" || features === "ask-stale") {
      this.project.features = features === "ask-stale" ? { ...off, ask: true, askConsent: agreed("gemini"), ...linked() } : { ...off, ask: false, ...linked() };
      this.credentials = { ...this.credentials, gemini: false, anthropic: true };
    }
  }

  /** The service Ask would use: Gemini first, as in the app. */
  private askProvider(): AskProvider | null {
    return this.credentials.gemini ? "gemini" : this.credentials.anthropic ? "anthropic" : null;
  }

  /** `story` is the scenario by default. Try the demo in the "new" story builds the broken one. */
  reset(story: Scenario = this.scenario): void {
    const base: FileMap = { ".gitignore": "1", "package.json": "1", "config/app.json": "USD", "src/tips.js": "ok", "test/tips.test.js": "1" };
    const split = { ...base, "src/split.js": "1", "test/split.test.js": "1" };
    const dark = { ...split, "src/theme.js": "1", "test/theme.test.js": "1" };
    const broke = { ...dark, "src/tips.js": "broken" };
    const eur = { ...broke, "config/app.json": "EUR" };
    const dep = { ...eur, "package.json": "2", "package-lock.json": "1" };
    const cfg = { "timemachine.yml": "1" };
    const themes = { ...cfg, "data/themes.json": "1" };
    this.points = [
      makePoint(1, "Initial tip calculator", ago(148), "app", base, cfg, {}),
      makePoint(2, "Added split bill", ago(113), "claude-code:stop", split, cfg, {}, "add a split bill button"),
      makePoint(3, "Added dark mode", ago(76), "claude-code:stop", dark, themes, {}, "add dark mode"),
      makePoint(4, "Agent: fixed lint warnings", ago(37), "claude-code:stop", broke, themes, {}, "fix the lint warnings"),
      makePoint(5, "Changed currency", ago(12), "app", eur, themes, {}),
      makePoint(6, "Added a dependency", ago(3), "claude-code:stop", dep, themes, { "package-lock.json": "1" }, "format prices with a currency package"),
    ];
    // Checked when they were saved: the first three worked. The check after the last agent turn failed.
    for (const id of ["cp-0001", "cp-0002", "cp-0003"]) this.setVerdict(id, "PASS");
    this.setVerdict("cp-0006", "FAIL");
    // Shorter stories: it still works (three passing save points), or the newest one is not checked yet.
    if (story === "works") this.points = this.points.slice(0, 3);
    if (story === "unchecked") this.points = this.points.slice(0, 4);
    if (story === "new") {
      this.seed = this.points[0] ?? null;
      this.points = [];
      this.added = false;
      this.settings = { ...this.settings, onboarded: false };
    }
    this.audit = this.points.map((p) => ({ at: p.entry.createdAt, action: "checkpoint", target: p.entry.id, result: "saved" }));
    this.branches.clear();
  }

  private setVerdict(id: string, v: Verdict): void {
    const p = this.points.find((x) => x.entry.id === id);
    if (p) p.entry = { ...p.entry, verdict: v, isolation: "host" };
  }

  private emit(e: AppEvent): void {
    for (const l of this.listeners) l(e);
  }

  onEvent(cb: (e: AppEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  navigate(e: AppEvent): void {
    this.emit(e);
  }

  timelineEntries(): TimelineEntry[] {
    return this.points.map((p) => p.entry);
  }

  async call<M extends Method>(call: CallOf<M>): Promise<Res<Results[M]>> {
    try {
      const c = call as Call;
      // Same check as the app, so the preview never opens a page the app would refuse.
      if (c.method === "openExternal" && !isAllowedExternal(c.url)) throw new Error(EXTERNAL_REFUSED);
      const data = (await this.dispatch(c)) as Results[M];
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: { kind: "usage", message: e instanceof Error ? e.message : String(e) } };
    }
  }

  private find(id: string): Point {
    const p = this.points.find((x) => x.entry.id === id);
    if (!p) throw new Error(`There is no checkpoint ${id}. Run tm timeline to see them.`);
    return p;
  }

  /** Any listed project: the demo or one beside it. */
  private entry(projectId: string): ProjectEntry {
    const p = projectId === PROJECT_ID && this.added ? this.project : this.sides.find((s) => s.project.id === projectId)?.project;
    if (!p) throw new Error("That project is no longer in the list.");
    return p;
  }

  /** The save points and audit log of any listed project. */
  private history(projectId: string): { points: Point[]; audit: SideStory["audit"] } {
    if (projectId === PROJECT_ID && this.added) return { points: this.points, audit: this.audit };
    const s = this.sides.find((x) => x.project.id === projectId);
    if (!s) throw new Error("That project is no longer in the list.");
    return { points: s.points, audit: s.audit };
  }

  /** The calls for a project beside the demo. Same shapes as the engine; a folder recovers to a copy only. */
  private async sideDispatch(call: Call, s: SideStory): Promise<unknown> {
    const p = s.project;
    const find = (id: string): Point => {
      const x = s.points.find((y) => y.entry.id === id);
      if (!x) throw new Error(`There is no checkpoint ${id}. Run tm timeline to see them.`);
      return x;
    };
    const verify = async (id: string): Promise<VerifyResult> => {
      if (!s.check) throw new Error(`${p.name} has no check yet. A check is optional for a folder. Add one to test a save point in a safe copy.`);
      const x = find(id);
      await wait(700 + Math.random() * 400);
      const verdict: Verdict = s.passes(x.tracked) ? "PASS" : "FAIL";
      x.entry = { ...x.entry, verdict, isolation: "host" };
      s.audit.push({ at: new Date().toISOString(), action: "verify", target: id, result: verdict });
      return record(x.entry, s.check, new Date().toISOString());
    };
    switch (call.method) {
      case "timeline":
        return { project: p.path, checkpoints: s.points.map((x) => x.entry) };
      case "diff":
        await wait(120);
        return diffPoints(find(call.a), find(call.b));
      case "open":
        await wait(500);
        return { id: call.id, dir: `/private/var/folders/tm/tm-open-${p.name}-${call.id}`, isolation: "host", restored: find(call.id).entry.coverage.restorable, missing: [], manual: [] };
      case "verify":
        return verify(call.id);
      case "checkLogTail": {
        const x = find(call.id);
        if (!x.entry.verdict || !s.check) return null;
        return { log: `/Users/you/.timemachine/projects/${p.name}/logs/${call.id}.log`, binary: false, hidden: false, lines: [`$ ${s.check}`, "", x.entry.verdict === "PASS" ? "summary ok: 3 runs, no missing values" : "summary failed: column 'dose_mg' not found"] };
      }
      case "checkRecord": {
        const x = find(call.id);
        return x.entry.verdict && s.check ? record(x.entry, s.check, x.entry.createdAt) : null;
      }
      case "findGood": {
        if (!s.check) throw new Error(`${p.name} has no check yet, so there is nothing to test save points with.`);
        const tried: FindGoodResult["tried"] = [];
        for (const x of [...s.points].reverse()) {
          const v = await verify(x.entry.id);
          tried.push({ id: v.checkpoint, verdict: v.verdict, reason: v.reason });
          this.emit({ type: "progress", projectId: p.id, checkpoint: v.checkpoint, verdict: v.verdict });
          if (v.verdict === "PASS") return { verdict: "PASS", found: v.checkpoint, tried };
        }
        return { verdict: "FAIL", found: null, tried };
      }
      case "stopCheck":
        return false;
      case "checkpoint": {
        const last = s.points.at(-1);
        if (!last) throw new Error("No project");
        if (call.ifChanged) return { checkpoint: last.entry, skipped: true };
        await wait(300);
        const x = sidePoint(nextNumber(s.points), call.note ?? "Saved by you", new Date().toISOString(), { ...last.tracked, ...last.untracked }, p.kind === "folder");
        s.points.push(x);
        s.audit.push({ at: x.entry.createdAt, action: "checkpoint", target: x.entry.id, result: "saved" });
        return { checkpoint: x.entry, skipped: false };
      }
      case "recover": {
        await wait(700);
        const target = find(call.id);
        const last = s.points.at(-1);
        if (!last) throw new Error("No save points");
        const saved = sidePoint(nextNumber(s.points), `Before recovering ${call.id}`, new Date().toISOString(), { ...last.tracked, ...last.untracked }, p.kind === "folder");
        s.points.push(saved);
        const copyDir = `${p.path}-recovered-${call.id}`;
        s.copies.add(copyDir);
        const folder = p.kind === "folder";
        const r: RecoverResult = {
          id: call.id, branch: folder ? "" : `tm/recover/${call.id}`, copyDir, savedBefore: saved.entry.id, reportPath: `/Users/you/.timemachine/projects/${p.name}/reports/recover-${call.id}.md`, missing: [],
          lastVerdict: target.entry.verdict, restored: target.entry.coverage.restorable, notRestored: target.entry.coverage.manual,
          manualSteps: [
            ...(folder ? ["No branch was made: this folder has no Git repo, so the save point came back as a copy only."] : []),
            `Review the recovery copy at ${copyDir}.`,
            "Copy back the files you want to keep. Your folder was not touched.",
          ],
          pushed: false, ...(folder ? { copyOnly: true as const } : {}),
        };
        s.audit.push({ at: new Date().toISOString(), action: "recover", target: call.id, result: folder ? `copy ${copyDir}` : `branch ${r.branch}` });
        return r;
      }
      case "restorePaths": {
        await wait(500);
        const target = find(call.id);
        const saved = call.dryRun ? null : sidePoint(nextNumber(s.points), `Before putting files back from ${call.id}`, new Date().toISOString(), { ...target.tracked, ...target.untracked }, p.kind === "folder");
        if (saved) s.points.push(saved);
        const r: RestoreResult = {
          id: call.id, dryRun: !!call.dryRun, restored: call.paths, kept: [], skipped: [], savedBefore: saved?.entry.id ?? null,
          diff: { added: 0, changed: call.paths.length, same: 0 }, ...(p.kind === "folder" ? {} : { note: "Files written; nothing committed." }),
        };
        if (saved) s.audit.push({ at: new Date().toISOString(), action: "restore", target: call.id, result: `${call.paths.length} paths` });
        return r;
      }
      case "undoRecover": {
        await wait(300);
        if (!s.copies.delete(call.copyDir)) throw new Error(`${call.copyDir} is not a recovery copy this app made, so it was left alone.`);
        const r: UndoRecoverResult = { id: call.id, removedBranch: call.branch, removedCopy: call.copyDir };
        return r;
      }
      case "log":
        return { entries: s.audit };
      case "init":
        return { configPath: `/Users/you/.timemachine/projects/${p.name}/timemachine.yml`, created: false, verifyCommand: s.check ?? "", verifySetup: "", network: "allow", sandbox: null, approvedCheck: s.check };
      case "setCheck":
        s.check = call.command;
        return { configPath: `/Users/you/.timemachine/projects/${p.name}/timemachine.yml`, verifyCommand: call.command };
      case "hookPreview":
        return { settingsPath: `${p.path}/.claude/settings.json`, command: "tm", runs: true, plugin: false, lines: [] };
      case "hookInstall":
      case "forget":
        throw new Error("The preview connects Claude Code to the demo project only.");
      case "cleanStore":
        return { files: [], bytes: 0, applied: call.apply };
      case "setFeature": {
        p.features = withFeature(p.features, call.change, this.askProvider());
        return p;
      }
      case "ask":
        throw new Error(`The preview answers questions about the demo project only. Ask about ${p.name} in the app.`);
      case "deployments":
        return null;
      default:
        throw new Error(`The preview can't do ${call.method} for ${p.name}.`);
    }
  }

  private async verify(id: string): Promise<VerifyResult> {
    const p = this.find(id);
    await wait(900 + Math.random() * 500);
    const pass = p.tracked["src/tips.js"] === "ok";
    const verdict: Verdict = pass ? "PASS" : "FAIL";
    this.setVerdict(id, verdict);
    this.audit.push({ at: new Date().toISOString(), action: "verify", target: id, result: verdict });
    return {
      at: new Date().toISOString(), checkpoint: id, verdict, isolation: "host", network: { policy: "allow", enforcedBy: null },
      command: "npm test", durationMs: Math.round(1800 + Math.random() * 900), exitCode: pass ? 0 : 1,
      reason: pass ? "The check passed." : "The check failed with exit code 1.", log: `/Users/you/.timemachine/projects/demo/logs/${id}.log`,
    };
  }

  private report(r: RecoverResult): string {
    return [
      `# Recovery report: ${r.id}`, "", "Nothing was pushed, merged or deployed. Your current folder and branch were not touched.",
      `Before this recovery, your current state was saved as ${r.savedBefore}, so you can come back to it.`, "", `Branch: ${r.branch}`, `Recovery copy: ${r.copyDir}`, "",
      "## Restored", ...r.restored.map((x) => `- ${x}`), "", "## Not restored", ...r.notRestored.map((x) => `- ${x}`), "",
      "## Manual steps", ...r.manualSteps.map((x, i) => `${i + 1}. ${x}`), "",
      "Restored: code, captured files, config. Not restored: database, deployed version, secret values.", "",
    ].join("\n");
  }

  private lastRecover: RecoverResult | null = null;

  /** Canned answers to the sample questions, from the demo story. The app asks Gemini instead. */
  private askAnswer(question: string): AskResult {
    const time = (id: string): string => clock(this.find(id).entry.createdAt);
    const at = (id: string): string => `${time(id)}, ${this.find(id).entry.note}`;
    const q = question.trim().toLowerCase();
    const [lastWorked, changedAfter] = ASK_EXAMPLES.map((x) => x.toLowerCase());
    // The app sends the newest 50 save points.
    const basis = Math.min(50, this.points.length);
    if (this.scenario !== "broken") {
      return { answer: `The preview has sample answers for the demo story only. Try one of these: ${ASK_EXAMPLES.join(" ")}`, cites: [], basis };
    }
    if (!ASK_EXAMPLES.some((x) => x.toLowerCase() === q)) {
      return { answer: "I can't tell from the history. The preview only has answers for the suggested questions.", cites: [], basis };
    }
    if (q === lastWorked) {
      return {
        answer: `It last worked at the save at ${at("cp-0003")}. Its check passed. The newest save, at ${at("cp-0006")}, failed its check.`,
        cites: ["cp-0003", "cp-0006"],
        basis,
      };
    }
    if (q === changedAfter) {
      return {
        answer: `After the save at ${at("cp-0003")}, Claude Code changed src/tips.js at ${at("cp-0004")}. Then config/app.json changed at ${at("cp-0005")}. Then package.json and package-lock.json changed at ${at("cp-0006")}, and that check failed. The two saves in between were not checked, so I can't tell which change broke it.`,
        cites: ["cp-0004", "cp-0005", "cp-0006"],
        basis,
      };
    }
    return {
      answer: `Claude Code made four saves. It added split bill at ${time("cp-0002")} and dark mode at ${time("cp-0003")}, and both passed their checks. It fixed lint warnings at ${time("cp-0004")}, which was not checked. It added a currency package at ${time("cp-0006")}, and that check failed.`,
      cites: ["cp-0002", "cp-0003", "cp-0004", "cp-0006"],
      basis,
    };
  }

  private async dispatch(call: Call): Promise<unknown> {
    switch (call.method) {
      case "bootstrap":
        return { platform: "darwin", settings: this.settings, projects: this.added ? [this.project, ...this.sides.map((s) => s.project)] : [], storeDir: "~/.timemachine", preview: true, license: this.license };
      case "sources":
        return FAKE_SOURCES.map((s) => ({ ...s }));
      case "setPurpose": {
        const p = this.entry(call.projectId);
        p.purpose = call.purpose;
        return p;
      }
      case "thinPreview": {
        const h = this.history(call.projectId);
        return thinPlan(h.points, this.notes.get(call.projectId) ?? {}, h.audit, Date.now());
      }
      case "thinApply": {
        // Like the engine: a fresh preview first, and any id not in it refuses the whole call.
        const h = this.history(call.projectId);
        const allowed = new Set(thinPlan(h.points, this.notes.get(call.projectId) ?? {}, h.audit, Date.now()).remove.map((r) => r.id));
        const bad = call.ids.find((id) => !allowed.has(id));
        if (bad !== undefined) throw new Error(`${bad} can't be thinned now: only old auto saves in a fresh preview can go. Nothing was removed.`);
        const gone = new Set(call.ids);
        if (!gone.size) return { removed: 0 };
        const kept = h.points.filter((x) => !gone.has(x.entry.id));
        h.points.splice(0, h.points.length, ...kept);
        h.audit.push({ at: new Date().toISOString(), action: "thin", target: null, result: `removed ${gone.size} old auto save${gone.size === 1 ? "" : "s"}: ${[...gone].join(", ")}` });
        return { removed: gone.size };
      }
      case "notes":
        this.entry(call.projectId);
        return { ...this.notes.get(call.projectId) };
      case "setNote": {
        // The same check as the engine, so the preview never keeps a note the app would refuse.
        if ([call.title, call.note].some((t) => t !== undefined && looksSecret(t))) throw new Error(NOTE_LOOKS_SECRET);
        const p = this.entry(call.projectId);
        const side = this.sides.find((s) => s.project.id === p.id);
        if (!(side ? side.points : this.points).some((x) => x.entry.id === call.id)) throw new Error(`There is no checkpoint ${call.id}. Run tm timeline to see them.`);
        const all = { ...this.notes.get(p.id) };
        const before = all[call.id];
        const title = (call.title ?? before?.title)?.trim();
        const note = call.note ?? before?.note;
        const next: RunNote = { ...(title ? { title } : {}), ...(note ? { note } : {}), pinned: call.pinned ?? before?.pinned ?? false, updated: new Date().toISOString() };
        if (next.title === undefined && next.note === undefined && !next.pinned) delete all[call.id];
        else all[call.id] = next;
        this.notes.set(p.id, all);
        return next;
      }
      case "license":
      case "removeLicense":
        return this.license;
      case "setLicense":
        throw new Error("The preview can't check license keys. Download the app to add yours.");
      case "siteStatus":
        return { checkout: true, auth: true };
      case "signIn":
        agreedLikeTheSite(call);
        return { ok: true };
      case "verifyCode":
        agreedLikeTheSite(call);
        if (call.code !== "123456") throw new Error("That code didn't match.");
        this.signedIn = call.email;
        return { ok: true };
      case "signOut":
        this.signedIn = null;
        return { ok: true };
      case "accountLicenses":
        // One made-up key for the screens. It is not signed, so no app accepts it.
        return this.signedIn
          ? { email: this.signedIn, licenses: [{ key: "TM1.eyJ2IjoxLCJpZCI6ImNzX3ByZXZpZXciLCJwbGFuIjoid2ViIn0.cHJldmlldy1vbmx5", id: "cs_preview0000000000000000", issued: "2026-10-22" }] }
          : null;
      case "addProject":
      case "previewProject": {
        if (this.scenario !== "new") throw new Error("The preview can't open folders on your computer. Download the app to use it on your projects.");
        const p = this.project;
        if (call.method === "previewProject") return { path: p.path, name: p.name, kind: p.kind, existingSavePoints: 0, scripts: ["test", "build"], check: { command: "npm test", setup: "npm ci --prefer-offline --no-audit --no-fund", network: "allow", exists: false } };
        this.added = true;
        if (call.purpose) this.project.purpose = call.purpose;
        return { ...this.project, existingSavePoints: 0, scripts: ["test", "build"] };
      }
      case "storeProjects":
        return [];
      case "pickFolder":
      case "reveal":
      case "relinkProject":
        throw new Error("The preview can't open folders on your computer. Download the app to use it on your projects.");
      case "removeProject":
        throw new Error("The preview keeps the demo project. Reload the page to start over.");
      case "statuses":
        return this.added ? [statusOf(PROJECT_ID, this.points), ...this.sides.map((s) => statusOf(s.project.id, s.points))] : [];
      default:
        break;
    }
    const side = "projectId" in call ? this.sides.find((s) => s.project.id === call.projectId) : undefined;
    if (side) return this.sideDispatch(call, side);
    switch (call.method) {
      case "init":
        return { configPath: `${ROOT}/timemachine.yml`, created: this.scenario === "new", verifyCommand: "npm test", verifySetup: "npm ci --prefer-offline --no-audit --no-fund", network: "allow", sandbox: null };
      case "setCheck":
        return { configPath: `${ROOT}/timemachine.yml`, verifyCommand: call.command };
      case "checkpoint": {
        const last = this.points.at(-1) ?? this.seed;
        if (!last) throw new Error("No project");
        if (call.ifChanged && this.points.length) return { checkpoint: last.entry, skipped: true };
        await wait(400);
        const n = this.points.length + 1;
        const p = makePoint(n, call.note ?? "Saved by you", new Date().toISOString(), "app", last.tracked, last.untracked, last.lockfiles);
        this.points.push(p);
        this.audit.push({ at: p.entry.createdAt, action: "checkpoint", target: p.entry.id, result: "saved" });
        return { checkpoint: p.entry, skipped: false };
      }
      case "timeline":
        return { project: ROOT, checkpoints: this.timelineEntries() };
      case "diff":
        await wait(150);
        return diffPoints(this.find(call.a), this.find(call.b));
      case "open": {
        await wait(700);
        const p = this.find(call.id);
        return { id: call.id, dir: `/private/var/folders/tm/tm-open-marigold-tips-${call.id}`, isolation: "host", restored: [`Code at commit ${p.entry.commit.slice(0, 7)}`, ...p.entry.coverage.restorable.slice(1)], missing: [], manual: [SECRETS] };
      }
      case "verify":
        return this.verify(call.id);
      case "checkLogTail": {
        // Synthetic output, the shape a real npm test log ends with. Not checked yet means no log.
        const p = this.find(call.id);
        if (!p.entry.verdict) return null;
        const pass = p.entry.verdict === "PASS";
        return {
          log: `/Users/you/.timemachine/projects/demo/logs/${call.id}.log`, binary: false, hidden: false,
          lines: pass ? ["$ npm test", "", "> marigold-tips@1.0.0 test", "> node test.js", "", "ok"] : ["$ npm test", "", "> marigold-tips@1.0.0 test", "> node test.js", "", "total: expected 3, got 4"],
        };
      }
      case "checkRecord": {
        // The stored record of a verdict seeded before this session: the same shape and log label a check here returns.
        const p = this.find(call.id);
        const verdict = p.entry.verdict;
        if (!verdict) return null;
        const pass = verdict === "PASS";
        return {
          at: p.entry.createdAt, checkpoint: call.id, verdict, isolation: "host", network: { policy: "allow", enforcedBy: null },
          command: "npm test", durationMs: pass ? 2140 : 2310, exitCode: pass ? 0 : 1,
          reason: pass ? "The check passed." : "The check failed with exit code 1.", log: `/Users/you/.timemachine/projects/demo/logs/${call.id}.log`,
        };
      }
      case "findGood": {
        const tried: FindGoodResult["tried"] = [];
        this.stopping = false;
        for (const p of [...this.points].reverse()) {
          const v = await this.verify(p.entry.id);
          if (this.stopping) return { verdict: "INCOMPLETE", found: null, tried, stopped: true };
          tried.push({ id: v.checkpoint, verdict: v.verdict, reason: v.reason });
          this.emit({ type: "progress", projectId: PROJECT_ID, checkpoint: v.checkpoint, verdict: v.verdict });
          if (v.verdict === "PASS") return { verdict: "PASS", found: v.checkpoint, tried };
        }
        return { verdict: "FAIL", found: null, tried };
      }
      case "stopCheck":
        // The preview stops a search after the check in progress; single checks are short enough to finish.
        this.stopping = true;
        return true;
      case "recover": {
        await wait(900);
        const target = this.find(call.id);
        const last = this.points.at(-1);
        if (!last) throw new Error("No save points");
        const saved = makePoint(this.points.length + 1, `Before recovering ${call.id}`, new Date().toISOString(), "recover", last.tracked, last.untracked, last.lockfiles);
        this.points.push(saved);
        let branch = `tm/recover/${call.id}`;
        for (let i = 2; this.branches.has(branch); i++) branch = `tm/recover/${call.id}-${i}`;
        this.branches.add(branch);
        const copyDir = `/Users/you/code/marigold-tips-recovered-${call.id}`;
        const r: RecoverResult = {
          id: call.id, branch, copyDir, savedBefore: saved.entry.id, reportPath: `/Users/you/.timemachine/projects/demo/reports/recover-${call.id}.md`, missing: [],
          lastVerdict: target.entry.verdict,
          restored: [`Code at commit ${target.entry.commit.slice(0, 7)}`, ...target.entry.coverage.restorable.slice(1)],
          notRestored: [SECRETS, NOT_CAPTURED],
          manualSteps: ["Set PORT in .env in the recovery copy.", "Set STRIPE_SECRET_KEY in .env in the recovery copy.", `Review the recovery copy at ${copyDir}.`, "Keep working in the recovery copy. Review and commit the restored files you want to keep before moving or removing it."],
          pushed: false,
        };
        this.lastRecover = r;
        this.audit.push({ at: new Date().toISOString(), action: "recover", target: call.id, result: `branch ${branch}` });
        return r;
      }
      case "undoRecover": {
        await wait(500);
        if (!this.branches.has(call.branch)) throw new Error(`There is no branch ${call.branch}. It may already be gone.`);
        this.branches.delete(call.branch);
        this.audit.push({ at: new Date().toISOString(), action: "undo-recover", target: call.id, result: `removed branch ${call.branch} and its recovery copy` });
        return { id: call.id, removedBranch: call.branch, removedCopy: call.copyDir };
      }
      case "log":
        return { entries: this.audit };
      case "hookPreview": {
        // What a source checkout run of tm ui writes: its own copy of the CLI, run by its own Node.
        const command = "'/usr/local/bin/node' '/Users/you/code/Time-Machine/packages/cli/dist/tm.js'";
        return {
          settingsPath: `${ROOT}/.claude/settings.json`, command, runs: true, plugin: false,
          lines: [{ event: "UserPromptSubmit", command: `${command} hook prompt` }, { event: "PreToolUse (Bash)", command: `${command} hook pre-bash` }, { event: "Stop", command: `${command} hook stop` }],
        };
      }
      case "hookInstall":
        await wait(300);
        this.claudeConnected = true;
        return { settingsPath: `${ROOT}/.claude/settings.json`, added: [], alreadyPresent: ["UserPromptSubmit", "PreToolUse", "Stop"] };
      case "forget": {
        await wait(300);
        const r: ForgetResult = { approvalRemoved: this.claudeConnected, hooksRemoved: this.claudeConnected ? [{ path: `${ROOT}/.claude/settings.json`, removed: ["UserPromptSubmit", "PreToolUse", "Stop"] }] : [], unreadable: [], store: `/Users/you/.timemachine/projects/${PROJECT_ID}` };
        this.claudeConnected = false;
        return r;
      }
      case "demo": {
        // The new-user walkthrough builds the demo story, then rescues it with the same steps as the engine.
        if (this.scenario !== "new" || this.added) throw new Error("This preview is the demo. Reload the page to start the story over.");
        await wait(600);
        this.reset("broken");
        this.added = true;
        const findGood = (await this.dispatch({ method: "findGood", projectId: PROJECT_ID })) as FindGoodResult;
        if (!findGood.found) throw new Error("The demo could not find a working save point.");
        const recover = (await this.dispatch({ method: "recover", projectId: PROJECT_ID, id: findGood.found })) as RecoverResult;
        const checkpoints = this.points.slice(0, 6).map((p) => ({ id: p.entry.id, note: p.entry.note ?? "", expect: p.tracked["src/tips.js"] === "ok" ? ("PASS" as const) : ("FAIL" as const) }));
        return { project: { ...this.project, existingSavePoints: 0, scripts: ["test", "build"] }, result: { dir: ROOT, checkpoints, findGood, recover } };
      }
      case "storage": {
        const rows = this.added
          ? [
            { projectId: PROJECT_ID, name: "marigold-tips", bytes: 186_112 + this.points.length * 4096, storeDir: "~/.timemachine/projects/e3179f5ab665d193" },
            ...this.sides.map((s, i) => ({ projectId: s.project.id, name: s.project.name, bytes: 92_160 + i * 311_296 + s.points.length * 6144, storeDir: `~/.timemachine/projects/${hash(s.project.id).slice(0, 16)}` })),
          ]
          : [];
        const git = this.added ? [this.project, ...this.sides.map((s) => s.project)].filter((p) => p.kind === "git").map((p) => p.name) : [];
        return {
          rows,
          storeBytes: rows.reduce((n, r) => n + r.bytes, 0) + 4096,
          storeDir: "~/.timemachine",
          note: git.length ? `Code projects (${git.join(", ")}) also keep their save points inside the project's own .git folder. That space is not counted here.` : null,
        };
      }
      case "projectConfig":
        return { ...this.checkConfig };
      case "setProjectConfig":
        this.checkConfig = { ...this.checkConfig, ...call.patch };
        return { ...this.checkConfig };
      case "cleanStore":
        await wait(200);
        return { files: [], bytes: 0, applied: call.apply };
      case "agents":
        return this.added ? [{ projectId: PROJECT_ID, name: "marigold-tips", claudeCode: this.claudeConnected ? "connected" : "not-connected", via: "settings", pluginOff: false, check: "npm test", settingsPath: `${ROOT}/.claude/settings.json`, missing: this.claudeConnected ? [] : ["UserPromptSubmit", "PreToolUse", "Stop"], working: false, workingSince: null }] : [];
      case "isolation":
        return { mode: "host", networkSandbox: "sandbox-exec" };
      case "setSettings":
        this.settings = { ...this.settings, ...call.patch };
        return this.settings;
      case "readReport":
        if (!this.lastRecover) throw new Error("No report yet.");
        return this.report(this.lastRecover);
      case "copy":
        try {
          await navigator.clipboard.writeText(call.text);
        } catch {
          // Clipboard access can be blocked in a preview frame. Nothing else to do.
        }
        return true;
      case "setActive":
        return true;
      case "openExternal":
        window.open(call.url, "_blank", "noopener,noreferrer");
        return true;
      case "setFeature": {
        this.project.features = withFeature(this.project.features, call.change, this.askProvider());
        return this.project;
      }
      case "credentials":
        return { ...this.credentials, provider: this.askProvider() };
      case "setCredential":
        this.credentials = { ...this.credentials, [call.name]: call.value !== null };
        return { configured: this.credentials[call.name] };
      case "ask":
        if (!this.project.features.ask) throw new Error(`Ask about your history is off for ${this.project.name}. Turn it on for this project first.`);
        if (!this.credentials.gemini && !this.credentials.anthropic) throw new Error("Ask needs an API key. Add a Gemini API key in Settings, or set GEMINI_API_KEY or ANTHROPIC_API_KEY before you start Time Machine.");
        if (!askConsentValid(this.project.features, this.askProvider())) throw new Error(`What Ask sends, or where it sends it, changed since Ask was turned on for ${this.project.name}. Nothing was sent. Read what Ask sends and turn it on again.`);
        await wait(900);
        if (this.features === "ask-error") throw new Error("Could not reach Gemini. Check the internet connection and try again.");
        return this.askAnswer(call.question);
      case "vercelProjects":
        if (!this.credentials.vercel) throw new Error("Add a Vercel token in Settings to see deploys. Time Machine only reads from Vercel.");
        return [{ teamId: "team_preview", teamName: "Your team", projectId: "prj_marigold", name: "marigold-tips", repo: "you/marigold-tips" }];
      case "deployments": {
        const link = this.project.features.vercel;
        if (!link || !vercelConsentValid(this.project.features)) return null;
        if (!this.credentials.vercel) throw new Error("Add a Vercel token in Settings to see deploys. Time Machine only reads from Vercel.");
        const result: DeploymentsResult = { link, matched: [], otherCommits: [], noCommit: [], fetchedAt: new Date().toISOString() };
        for (const [id, target] of [["cp-0002", "preview"], ["cp-0003", "production"]] as const) {
          const point = this.points.find((p) => p.entry.id === id)?.entry;
          if (!point) continue;
          const deployment: VercelDeployment = {
            id: `dpl_${id}`, url: `https://marigold-${target}.vercel.app`, target, state: "READY",
            createdAt: point.createdAt, creator: "you", source: "git", commit: point.head,
            branch: "main", dirty: false, inspectorUrl: `https://vercel.com/your-team/marigold-tips/dpl_${id}`,
          };
          result.matched.push({ deployment, savePoints: [{ id, exact: !point.dirty }] });
        }
        result.noCommit.push({
          id: "dpl_computer", url: "https://marigold-computer.vercel.app", target: "preview", state: "READY",
          createdAt: ago(25), creator: "you", source: "cli", commit: null, branch: null, dirty: false,
          inspectorUrl: "https://vercel.com/your-team/marigold-tips/dpl_computer",
        });
        return result;
      }
    }
  }
}
