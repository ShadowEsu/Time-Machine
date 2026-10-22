// An in-memory stand-in for the engine, used only by the browser preview. It replays the
// Marigold Tips demo story: six save points, cp-0004 broke it, find-good lands on cp-0003.
// All data is synthetic. The real app calls @timetm/core instead.
import type { DiffResult, FindGoodResult, RecoverResult, TimelineEntry, VerifyResult } from "@timetm/core";
import type { AppEvent, AskResult, Call, CallOf, CredentialName, DeploymentsResult, Method, ProjectEntry, ProjectStatus, Res, Results, Settings, TmBridge, VercelDeployment, Verdict } from "../src/shared/api.js";
import { ASK_EXAMPLES } from "../src/shared/ask.js";
import { clock } from "../src/shared/format.js";
import { EXTERNAL_REFUSED, isAllowedExternal } from "../src/shared/links.js";

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
 */
export type FeatureStory = "off" | "on" | "ask-off" | "no-key" | "ask-error" | "no-vercel";

const SCENARIOS: readonly Scenario[] = ["broken", "works", "unchecked", "new"];
const FEATURE_STORIES: readonly FeatureStory[] = ["ask-off", "no-key", "ask-error", "no-vercel"];

/**
 * The preview story for a ?state= value. ?state=works, unchecked or new tell a different story with
 * the features on. ?state=ask-off, no-key, ask-error or no-vercel tell the demo story with the
 * features in that state. With no value it is the demo story with the features on.
 */
export function previewStory(state: string | null): { scenario: Scenario; features: FeatureStory } {
  return {
    scenario: SCENARIOS.find((s) => s === state) ?? "broken",
    features: FEATURE_STORIES.find((s) => s === state) ?? "on",
  };
}

const PREVIEW_LINK = { teamId: "team_preview", projectId: "prj_marigold", name: "marigold-tips" } as const;

export class FakeEngine implements TmBridge {
  private listeners = new Set<(e: AppEvent) => void>();
  private points: Point[] = [];
  private audit: { at: string; action: string; target: string | null; result: string }[] = [];
  private branches = new Set<string>();
  /** "new" starts with no project. Adding the sample folder makes this true. */
  private added = true;
  private seed: Point | null = null;
  private stopping = false;
  settings: Settings = { showGitDetails: false, overlayCards: true, theme: "system", onboarded: true, simpleRewind: false, hotkey: "Control+Alt+T", agentPill: true, verdictTipSeen: false };
  readonly project: ProjectEntry = { id: PROJECT_ID, path: ROOT, name: "marigold-tips", addedAt: ago(200), demo: true, features: { ask: false, vercel: null } };
  /** Whether each key is set. The preview never holds a real key. */
  private credentials: Record<CredentialName, boolean> = { gemini: true, vercel: true };

  constructor(readonly scenario: Scenario = "broken", readonly features: FeatureStory = "off") {
    this.reset();
    if (features === "on" || features === "ask-error") this.project.features = { ask: true, vercel: { ...PREVIEW_LINK } };
    if (features === "ask-off") this.project.features = { ask: false, vercel: { ...PREVIEW_LINK } };
    if (features === "no-key") {
      this.project.features = { ask: false, vercel: { ...PREVIEW_LINK } };
      this.credentials = { ...this.credentials, gemini: false };
    }
    if (features === "no-vercel") {
      this.project.features = { ask: true, vercel: null };
      this.credentials = { ...this.credentials, vercel: false };
    }
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

  private status(): ProjectStatus {
    const newest = this.points.at(-1)?.entry;
    const working = [...this.points].reverse().find((p) => p.entry.verdict === "PASS" && p.entry.id !== newest?.id)?.entry;
    return {
      projectId: PROJECT_ID,
      newest: newest ? { id: newest.id, verdict: newest.verdict, createdAt: newest.createdAt } : null,
      lastWorking: working ? { id: working.id, createdAt: working.createdAt, note: working.note } : null,
      problem: null,
    };
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

  private diff(a: string, b: string): DiffResult {
    const pa = this.find(a);
    const pb = this.find(b);
    const cmp = (x: FileMap, y: FileMap): { added: string[]; removed: string[]; changed: string[] } => ({
      added: Object.keys(y).filter((k) => !(k in x)),
      removed: Object.keys(x).filter((k) => !(k in y)),
      changed: Object.keys(x).filter((k) => k in y && x[k] !== y[k]),
    });
    const code = cmp(pa.tracked, pb.tracked);
    const deps = cmp(pa.lockfiles, pb.lockfiles);
    return {
      a, b,
      code: [...code.added.map((path) => ({ status: "A", path })), ...code.removed.map((path) => ({ status: "D", path })), ...code.changed.map((path) => ({ status: "M", path }))].sort((x, y) => x.path.localeCompare(y.path)),
      files: cmp(pa.untracked, pb.untracked),
      config: { added: [], removed: [], changed: [] },
      dependencies: { changed: [...deps.added, ...deps.removed, ...deps.changed] },
      environment: { changed: [] },
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
        // A browser page can't own a global shortcut, so it is never active here.
        return { platform: "darwin", settings: this.settings, projects: this.added ? [this.project] : [], hotkey: this.settings.hotkey ?? "", hotkeyActive: false, storeDir: "~/.timemachine", preview: true };
      case "chooseFolder":
        // The new-user walkthrough picks the sample folder. Real folders need the app.
        if (this.scenario === "new") return ROOT;
        throw new Error("The preview can't open folders on your computer. Download the app to use it on your projects.");
      case "addProject":
        if (this.scenario !== "new") throw new Error("The preview can't open folders on your computer. Download the app to use it on your projects.");
        this.added = true;
        return this.project;
      case "removeProject":
        throw new Error("The preview keeps the demo project. Reload the page to start over.");
      case "statuses":
        return this.added ? [this.status()] : [];
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
        return this.diff(call.a, call.b);
      case "open": {
        await wait(700);
        const p = this.find(call.id);
        return { id: call.id, dir: `/private/var/folders/tm/tm-open-marigold-tips-${call.id}`, isolation: "host", restored: [`Code at commit ${p.entry.commit.slice(0, 7)}`, ...p.entry.coverage.restorable.slice(1)], missing: [], manual: [SECRETS] };
      }
      case "verify":
        return this.verify(call.id);
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
          id: call.id, branch, copyDir, savedBefore: saved.entry.id, reportPath: `/Users/you/.timemachine/projects/demo/reports/recover-${call.id}.md`,
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
        // What a source checkout run of the app writes: its own copy of the CLI, run by its own Node.
        const command = "ELECTRON_RUN_AS_NODE=1 '/Users/you/code/Time-Machine/apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' '/Users/you/code/Time-Machine/apps/desktop/out/tm.mjs'";
        return {
          settingsPath: `${ROOT}/.claude/settings.json`, command, runs: true,
          lines: [{ event: "UserPromptSubmit", command: `${command} hook prompt` }, { event: "PreToolUse (Bash)", command: `${command} hook pre-bash` }, { event: "Stop", command: `${command} hook stop` }],
        };
      }
      case "hookInstall":
        await wait(300);
        return { settingsPath: `${ROOT}/.claude/settings.json`, added: [], alreadyPresent: ["UserPromptSubmit", "PreToolUse", "Stop"] };
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
        return { project: this.project, result: { dir: ROOT, checkpoints, findGood, recover } };
      }
      case "storage":
        return this.added ? [{ projectId: PROJECT_ID, name: "marigold-tips", bytes: 186_112 + this.points.length * 4096, storeDir: "~/.timemachine/projects/e3179f5ab665d193" }] : [];
      case "cleanStore":
        await wait(200);
        return { files: [], bytes: 0, applied: call.apply };
      case "agents":
        return this.added ? [{ projectId: PROJECT_ID, name: "marigold-tips", claudeCode: "connected", settingsPath: `${ROOT}/.claude/settings.json`, missing: [], working: false, workingSince: null }] : [];
      case "isolation":
        return { mode: "host", networkSandbox: "sandbox-exec" };
      case "setSettings":
        this.settings = { ...this.settings, ...call.patch };
        return this.settings;
      case "reveal":
        throw new Error("The preview has no folders to show. In the app this opens Finder.");
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
        const c = call.change;
        this.project.features = c.feature === "ask" ? { ...this.project.features, ask: c.enabled } : { ...this.project.features, vercel: c.link };
        return this.project;
      }
      case "credentials":
        return this.credentials;
      case "setCredential":
        this.credentials = { ...this.credentials, [call.name]: call.value !== null };
        return { configured: this.credentials[call.name] };
      case "ask":
        if (!this.project.features.ask) throw new Error(`Ask about your history is off for ${this.project.name}. Turn it on for this project first.`);
        if (!this.credentials.gemini) throw new Error("Add a Gemini API key in Settings first.");
        await wait(900);
        if (this.features === "ask-error") throw new Error("Could not reach Gemini. Check the internet connection and try again.");
        return this.askAnswer(call.question);
      case "vercelProjects":
        if (!this.credentials.vercel) throw new Error("Add a Vercel token in Settings to see deploys. Time Machine only reads from Vercel.");
        return [{ teamId: "team_preview", teamName: "Your team", projectId: "prj_marigold", name: "marigold-tips", repo: "you/marigold-tips" }];
      case "deployments": {
        const link = this.project.features.vercel;
        if (!link) return null;
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
