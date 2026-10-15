// An in-memory stand-in for the engine, used only by the browser preview. It replays the
// Marigold Tips demo story: six save points, cp-0004 broke it, find-good lands on cp-0003.
// All data is synthetic. The real app calls @timetm/core instead.
import type { DiffResult, FindGoodResult, RecoverResult, TimelineEntry, VerifyResult } from "@timetm/core";
import type { AppEvent, Call, CallOf, Method, ProjectEntry, ProjectStatus, Res, Results, Settings, TmBridge, Verdict } from "../src/shared/api.js";

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

function makePoint(n: number, note: string, time: string, trigger: string, tracked: FileMap, untracked: FileMap, lockfiles: FileMap): Point {
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
      id, createdAt: time, note, trigger, commit, branch: "main", dirty: files > 0, files,
      coverage: { captured, restorable: ["Code", ...(files ? [`${files} saved file${files === 1 ? "" : "s"}`] : [])], missing: [], manual: [SECRETS, NOT_CAPTURED] },
      verdict: null, isolation: null,
    },
    tracked, untracked, lockfiles,
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class FakeEngine implements TmBridge {
  private listeners = new Set<(e: AppEvent) => void>();
  private points: Point[] = [];
  private audit: { at: string; action: string; target: string | null; result: string }[] = [];
  private branches = new Set<string>();
  settings: Settings = { showGitDetails: false, overlayCards: true, theme: "system", onboarded: true };
  readonly project: ProjectEntry = { id: PROJECT_ID, path: ROOT, name: "marigold-tips", addedAt: ago(200), demo: true };

  constructor() {
    this.reset();
  }

  reset(): void {
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
      makePoint(2, "Added split bill", ago(113), "claude-code:stop", split, cfg, {}),
      makePoint(3, "Added dark mode", ago(76), "claude-code:stop", dark, themes, {}),
      makePoint(4, "Agent: fixed lint warnings", ago(37), "claude-code:stop", broke, themes, {}),
      makePoint(5, "Changed currency", ago(12), "app", eur, themes, {}),
      makePoint(6, "Added a dependency", ago(3), "claude-code:stop", dep, themes, { "package-lock.json": "1" }),
    ];
    // Checked when they were saved: the first three worked. The check after the last agent turn failed.
    for (const id of ["cp-0001", "cp-0002", "cp-0003"]) this.setVerdict(id, "PASS");
    this.setVerdict("cp-0006", "FAIL");
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
      const data = (await this.dispatch(call as Call)) as Results[M];
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
      newest: newest ? { id: newest.id, verdict: newest.verdict } : null,
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

  private async dispatch(call: Call): Promise<unknown> {
    switch (call.method) {
      case "bootstrap":
        return { platform: "darwin", settings: this.settings, projects: [this.project], hotkey: "CommandOrControl+Shift+T", storeDir: "~/.timemachine", preview: true };
      case "chooseFolder":
      case "addProject":
        throw new Error("The preview can't open folders on your computer. Download the app to use it on your projects.");
      case "removeProject":
        throw new Error("The preview keeps the demo project. Reload the page to start over.");
      case "statuses":
        return [this.status()];
      case "init":
        return { configPath: `${ROOT}/timemachine.yml`, created: false, verifyCommand: "npm test", network: "allow", sandbox: null };
      case "setCheck":
        return { configPath: `${ROOT}/timemachine.yml`, verifyCommand: call.command };
      case "checkpoint": {
        const last = this.points.at(-1);
        if (!last) throw new Error("No project");
        if (call.ifChanged) return { checkpoint: last.entry, skipped: true };
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
        for (const p of [...this.points].reverse()) {
          const v = await this.verify(p.entry.id);
          tried.push({ id: v.checkpoint, verdict: v.verdict, reason: v.reason });
          this.emit({ type: "progress", projectId: PROJECT_ID, checkpoint: v.checkpoint, verdict: v.verdict });
          if (v.verdict === "PASS") return { verdict: "PASS", found: v.checkpoint, tried };
        }
        return { verdict: "FAIL", found: null, tried };
      }
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
          manualSteps: ["Set PORT in .env in the recovery copy.", "Set STRIPE_SECRET_KEY in .env in the recovery copy.", `Review the recovery copy at ${copyDir}.`, `To use it in your main folder: git worktree remove "${copyDir}", then git switch ${branch}`],
          pushed: false,
        };
        this.lastRecover = r;
        this.audit.push({ at: new Date().toISOString(), action: "recover", target: call.id, result: `branch ${branch}` });
        return r;
      }
      case "log":
        return { entries: this.audit };
      case "hookPreview":
        return {
          settingsPath: `${ROOT}/.claude/settings.json`, command: "npx -y timetm",
          lines: [{ event: "UserPromptSubmit", command: "npx -y timetm hook prompt" }, { event: "PreToolUse (Bash)", command: "npx -y timetm hook pre-bash" }, { event: "Stop", command: "npx -y timetm hook stop" }],
        };
      case "hookInstall":
        await wait(300);
        return { settingsPath: `${ROOT}/.claude/settings.json`, added: [], alreadyPresent: ["UserPromptSubmit", "PreToolUse", "Stop"] };
      case "demo":
        throw new Error("This preview is the demo. Reload the page to start the story over.");
      case "storage":
        return [{ projectId: PROJECT_ID, name: "marigold-tips", bytes: 186_112 + this.points.length * 4096, storeDir: "~/.timemachine/projects/e3179f5ab665d193" }];
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
    }
  }
}
