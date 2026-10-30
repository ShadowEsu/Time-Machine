// Runs validated calls against the one engine, @timetm/core. The CLI calls the same
// functions, so the app and the CLI can never disagree.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, closeSync, constants, existsSync, fstatSync, lstatSync, openSync, opendirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import * as tm from "@timetm/core";
import { z } from "zod";
import { VERCEL_CONSENT_VERSION, vercelConsentValid, type AddedProject, type AgentRow, type AppEvent, type Call, type HookPreview, type IsolationInfo, type LicenseStatus, type ProjectCheckConfig, type ProjectEntry, type ProjectPreview, type ProjectStatus, type Purpose, type Res, type Results, type Settings, type StorageResult, type StoreProject } from "../shared/api.js";
import { ASK_CONSENT_VERSION } from "../shared/ask.js";
import { PMF_LOOKS_SECRET, pmfPayload, type PmfAnswers } from "../shared/pmf.js";
import { PRICING_URL } from "../shared/links.js";
import { Account, siteFromEnv } from "./account.js";
import { askHistory } from "./ask.js";
import { AutoSaver, type AutoSaveDeps, type AutoSaveReason } from "./autosave.js";
import type { Credentials } from "./credentials.js";
import { agentTurnStart, firstRunning } from "./rules.js";
import type { AppState } from "./state.js";
import { matchDeployments, Vercel } from "./vercel.js";

type EngineCall = Exclude<Call, { method: "bootstrap" | "setSettings" | "copy" | "setActive" | "openExternal" }>;

/** The commands the Claude Code hooks may call, best first, and the version they must answer with. */
export interface HookSetup {
  candidates: string[];
  version: string;
}

/** Runs a program with arguments, never through a shell. Answers its exit code (null when it timed out or failed to start) and output. */
export type ExecFn = (file: string, args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string }>;

// The package's TS lib predates Promise.withResolvers, so this uses the executor form.
const nodeExec: ExecFn = (file, args, timeoutMs) =>
  new Promise((done) => {
    execFile(file, args, { timeout: timeoutMs, shell: false, maxBuffer: 64 * 1024 }, (err, stdout) => {
      const code = err ? (typeof err.code === "number" && !err.killed ? err.code : null) : 0;
      done({ code, stdout: String(stdout) });
    });
  });

/** What the opt-in features reach outside this computer with. Tests pass a fake fetch and their own license key pair. */
export interface Services {
  credentials: Credentials;
  fetch: typeof fetch;
  /** The seller's public key that license keys are checked against. Tests pass a generated one. */
  licensePublicKey?: string;
  /** Auto save timing and watching. Tests pass short times and a fake watcher. */
  autoSave?: Omit<AutoSaveDeps, "save" | "busy">;
  /** Runs the Mac's folder chooser and Finder. Tests pass a fake. */
  exec?: ExecFn;
  /** process.platform unless a test says otherwise. */
  platform?: NodeJS.Platform;
}

const PackageScripts = z.object({ scripts: z.record(z.string(), z.unknown()).optional() });

export class Engine {
  /** Paths the engine handed back in this session. Only these can be revealed or read. */
  readonly allowedPaths = new Set<string>();
  /** Projects with an engine action running right now. */
  readonly busy = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  /** The running check or search per project, so Stop can end it. */
  private readonly stops = new Map<string, AbortController>();
  /** Vercel deploys, read only (ADR 0009). */
  private readonly vercel = new Vercel({ token: () => this.services.credentials.get("vercel"), fetch: (url, init) => this.services.fetch(url, init) });
  /** Sign-in to the Time Machine site to list bought keys. The token stays in this object's memory. */
  private readonly account = new Account({ site: () => siteFromEnv(process.env), fetch: (url, init) => this.services.fetch(url, init) });
  /** Saves projects with autoSave "change" when their files change, while the app is open. */
  readonly autoSaver: AutoSaver;
  /** The last auto save error per project, shown as its problem until an auto save works again. */
  private readonly autoSaveErrors = new Map<string, string>();
  /** Skip reasons already announced per project in this session, so each one is told once, not after every save. */
  private readonly announcedSkips = new Map<string, Set<string>>();
  private readonly listeners = new Set<(e: AppEvent) => void>();
  /** The timemachine.yml this app's init created in this session, by project, with its mark (device, inode, bytes) after the
   *  app's own last write. Backing out of the Add flow takes it out again, only while nobody else changed it. */
  private readonly madeSettings = new Map<string, { path: string; mark: string }>();

  constructor(
    private readonly state: AppState,
    private readonly hook: HookSetup,
    private readonly services: Services,
  ) {
    for (const p of state.projects) this.allowedPaths.add(p.path);
    this.autoSaver = new AutoSaver({
      ignoreDirs: [storeHome()],
      ...services.autoSave,
      busy: (id) => this.busy.has(id),
      save: (id, reason) => this.autoSave(id, reason),
    });
    this.syncAutoSave();
    // Edits made while the app was closed get one save soon after it starts.
    this.autoSaver.catchUp();
  }

  /** Events the engine pushes on its own, such as a save made by auto save. Returns the unsubscribe. */
  onEvent(cb: (e: AppEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Runs one of the app's own writes to a project's settings. If the file it created was changed by someone else before
   * this write, it is theirs now and Back forgets it (Security N1). After the write it carries the new mark only if its
   * bytes are exactly what this write put there (`written`, a sha256). A call that wrote nothing (or failed) leaves it the
   * app's only while the file is unchanged; any other change makes it the user's (Security R1 at 7edd14f, F2 at add3429).
   */
  private async ownWrite<T extends { read?: string; written?: string }>(projectId: string, write: () => T | Promise<T>): Promise<T> {
    const made = this.madeSettings.get(projectId);
    if (made && fileMark(made.path) !== made.mark) this.madeSettings.delete(projectId);
    let read: string | undefined;
    let written: string | undefined;
    try {
      const r = await write();
      read = r.read;
      written = r.written;
      return r;
    } finally {
      const still = this.madeSettings.get(projectId);
      if (still) {
        const mark = fileMark(still.path);
        // A call that wrote nothing (a patch with no changes) keeps the file the app's own, as long as it is unchanged.
        const unchanged = written === undefined && mark === still.mark;
        // Its own write: it read exactly the bytes the app last left (an edit just before the read was merged in otherwise,
        // Security F1) and the file now holds exactly what it wrote.
        const own = mark !== null && read !== undefined && written !== undefined && still.mark.endsWith(`:${read}`) && mark.endsWith(`:${written}`);
        if (own) still.mark = mark;
        else if (!unchanged) this.madeSettings.delete(projectId);
      }
    }
  }

  /** Watches exactly the listed projects that have auto save on. A project no longer watched drops its auto save error. */
  private syncAutoSave(): void {
    this.autoSaver.sync(this.state.projects.map((p) => ({ id: p.id, path: p.path, autoSave: p.features.autoSave })));
    const watched = new Set(this.autoSaver.watching());
    for (const id of this.autoSaveErrors.keys()) if (!watched.has(id)) this.autoSaveErrors.delete(id);
  }

  /**
   * Stops every auto save watch. The tm ui server (gated) does not call this today; the watches and
   * timers never keep the process alive, so they end with it.
   */
  close(): void {
    this.autoSaver.close();
  }

  /**
   * One auto save: queued like any other action, and skipped when nothing changed. The catch-up save when the
   * app starts counts as the app's own save. A failure becomes the project's problem in statuses, and each new
   * error message gets one autosave-failed audit entry. A save that left files out tells listeners why.
   */
  private autoSave(projectId: string, reason: AutoSaveReason): Promise<unknown> {
    const p = this.state.find(projectId);
    if (!p || !existsSync(p.path)) return Promise.resolve(null);
    const opts = reason === "start" ? { note: "Saved when the app started", trigger: "app" } : { note: "Auto save", trigger: "auto" };
    return this.serial(p.id, "Auto saving", () => tm.checkpoint(this.ctx(p), { ...opts, skipIfUnchanged: true })).then(
      (r) => {
        this.autoSaveErrors.delete(p.id);
        if (!r.skipped) this.announceSave(p.id, r.checkpoint);
        return r;
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        if (this.autoSaveErrors.get(p.id) !== message) {
          this.autoSaveErrors.set(p.id, message);
          try {
            tm.auditAutoSaveFailed(this.ctx(p), message);
          } catch {
            // The project can't be resolved or its store written: statuses still shows the error.
          }
        }
        throw e;
      },
    );
  }

  /** Tells listeners about a new save point, with the skip reasons not told before in this session. */
  private announceSave(projectId: string, cp: tm.CheckpointSummary): void {
    const told = this.announcedSkips.get(projectId) ?? new Set<string>();
    this.announcedSkips.set(projectId, told);
    const skipped = cp.coverage.missing.filter((m) => !told.has(m));
    for (const m of skipped) told.add(m);
    this.emit({ type: "saved", projectId, checkpoint: cp.id, trigger: cp.trigger, skipped });
  }

  private emit(event: AppEvent): void {
    for (const cb of this.listeners) cb(event);
  }

  /**
   * The survey's Send. Sends the answers with exactly what PMF_SENDS names: the app version and a random survey ID made for
   * this computer at the first Send (randomUUID, never from hardware, the user or a path). The Ask count and first-use date
   * stay here. An answer that looks like a key or password, or holds a secret value from a project's config files (the same
   * screen as Ask's history), blocks Send before anything leaves. Nothing is recorded as sent until the site said so.
   */
  private async sendFeedback(answers: PmfAnswers): Promise<Settings> {
    let s = this.state.readSettings();
    if (s.pmf.sentAt) throw new tm.TmError("usage", "These answers were already sent from this computer.");
    const screens = this.state.projects.flatMap((p) => {
      try {
        return [tm.secretScreen(this.ctx(p))];
      } catch {
        // A project that can't be read has no config values to compare; the key patterns below still apply.
        return [];
      }
    });
    if ([answers.q2, answers.q3, answers.q4].some((text) => tm.looksSecret(text) || screens.some((secret) => secret(text)))) {
      throw new tm.TmError("usage", PMF_LOOKS_SECRET);
    }
    // Kept before sending, so a retry after a failure sends the same ID.
    if (!s.pmf.installId) s = this.state.updateSettings({ pmf: { installId: randomUUID() } });
    const installId = s.pmf.installId;
    if (!installId) throw new tm.TmError("internal", "The survey ID could not be saved, so nothing was sent.");
    await this.account.sendFeedback(pmfPayload(answers, { installId, appVersion: this.hook.version }));
    const next = this.state.updateSettings({ pmf: { sentAt: new Date().toISOString() } });
    this.emit({ type: "settings", settings: next });
    return next;
  }

  ctx(p: ProjectEntry): tm.Ctx {
    return { cwd: p.path, env: process.env };
  }

  /** The license is computer wide, under the store root, so any existing folder works as the base. */
  private licenseCtx(): tm.Ctx {
    return { cwd: process.cwd(), env: process.env };
  }

  license(): LicenseStatus {
    return tm.licenseStatus(this.licenseCtx(), this.services.licensePublicKey);
  }

  /** The listed project. A missing folder is refused unless `missingOk`: its history in the store can still be read. */
  private project(id: string, missingOk = false): ProjectEntry {
    const p = this.state.find(id);
    if (!p) throw new tm.TmError("not_found", "That project is no longer in the list.");
    if (!missingOk && !existsSync(p.path)) throw new tm.TmError("not_found", missingSentence(p));
    return p;
  }

  /** One action at a time per project, so a Save now never races a Rewind. */
  private serial<T>(projectId: string, label: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(projectId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      this.busy.set(projectId, label);
      try {
        return await fn();
      } finally {
        this.busy.delete(projectId);
      }
    });
    this.queues.set(projectId, next);
    return next;
  }

  /** Runs `fn` with a signal that `stopCheck` aborts. One stoppable action per project at a time, as `serial` keeps it. */
  private stoppable<T>(projectId: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const c = new AbortController();
    this.stops.set(projectId, c);
    return fn(c.signal).finally(() => {
      if (this.stops.get(projectId) === c) this.stops.delete(projectId);
    });
  }

  /**
   * The newest save point and last working one. `problemKind` tells a missing folder ("Can't find it") from a
   * store this user can't write and from any other problem. A missing folder still shows its history when
   * the store can read it; a read-only store shows its history too, with the reason saving can't work.
   */
  async status(p: ProjectEntry): Promise<ProjectStatus> {
    const missing = !existsSync(p.path);
    try {
      const t = await tm.timeline(this.ctx(p));
      const last = t.checkpoints.at(-1);
      const working = [...t.checkpoints].reverse().find((c) => c.verdict === "PASS" && c.id !== last?.id) ?? null;
      const autoSave = this.autoSaveErrors.get(p.id);
      const [problem, problemKind]: [string | null, ProjectStatus["problemKind"]] = missing
        ? [missingSentence(p), "missing"]
        : !storeWritable() ? [storeDeniedSentence(), "permission"]
        : autoSave !== undefined ? [`Auto save failed: ${autoSave}`, "other"]
        : [null, null];
      return {
        projectId: p.id,
        newest: last ? { id: last.id, verdict: last.verdict, createdAt: last.createdAt } : null,
        lastWorking: working ? { id: working.id, createdAt: working.createdAt, note: working.note } : null,
        problem,
        problemKind,
      };
    } catch (e) {
      if (missing) return { projectId: p.id, newest: null, lastWorking: null, problem: missingSentence(p), problemKind: "missing" };
      const denied = storeDenied(e);
      if (denied) return { projectId: p.id, newest: null, lastWorking: null, problem: denied, problemKind: "permission" };
      return { projectId: p.id, newest: null, lastWorking: null, problem: e instanceof Error ? e.message : String(e), problemKind: "other" };
    }
  }

  /** What adding the folder at `input` would give, writing nothing: the project around it and its history so far. */
  async previewProject(input: string): Promise<ProjectPreview> {
    const path = folderAt(input);
    const ctx = { cwd: path, env: process.env };
    const { root, kind } = tm.protect(ctx, { dryRun: true });
    return { path: root, name: basename(root), kind, existingSavePoints: await this.savePointCount(root), scripts: packageScripts(root), check: tm.planInit(ctx) };
  }

  /**
   * Adds the project at `input`: an absolute path or one starting with ~. A folder the CLI or an earlier add
   * already protects keeps its history; `existingSavePoints` says how many save points it already has.
   */
  async addProject(input: string, demo = false, purpose?: Purpose): Promise<AddedProject> {
    // The engine resolves the project, so the app and the CLI agree on which one this is: the Git
    // repository around the folder, or else the folder itself as a plain folder project.
    const ctx = { cwd: folderAt(input), env: process.env };
    const planned = tm.protect(ctx, { dryRun: true });
    // Another window or the CLI may have changed the list since this one read it.
    const existing = this.state.reload().find((p) => p.path === planned.root);
    if (existing) {
      // Added again (another tab): the settings file is that project's now, so Back in the first tab must not take it out.
      this.madeSettings.delete(existing.id);
      return { ...existing, existingSavePoints: await this.savePointCount(existing.path), scripts: packageScripts(existing.path) };
    }
    // The free app lists a few projects. The demo is never refused; it counts like any other project after.
    const license = this.license();
    if (!demo && !license.active && this.state.projects.length >= license.freeProjectLimit) {
      throw new tm.TmError("usage", `The free web app lists up to ${license.freeProjectLimit} projects. Remove one to add another. A license, $50 once, lifts that limit: ${PRICING_URL}. If you already have a key, paste it in Settings, then License. Every restore stays free.`);
    }
    // A plain folder's history starts in the store here. Nothing is written in the folder.
    const { root, kind } = tm.protect(ctx);
    const p: Purpose = purpose ?? (kind === "folder" ? "documents" : "code");
    // Plain folders of documents, research or agent work have no hooks to save them, so they save on change.
    const autoSave = kind === "folder" && p !== "code" && p !== "other" ? "change" : "off";
    const entry: ProjectEntry = {
      id: randomUUID(), path: root, name: basename(root), addedAt: new Date().toISOString(), demo, features: { ask: false, vercel: null, autoSave },
      kind, purpose: p,
    };
    this.state.updateProjects((list) => [...list.filter((x) => x.path !== root), entry]);
    this.allowedPaths.add(root);
    this.syncAutoSave();
    return { ...entry, existingSavePoints: await this.savePointCount(root), scripts: packageScripts(root) };
  }

  /** How many save points the project at `root` has. 0 for one with no history yet. */
  private async savePointCount(root: string): Promise<number> {
    try {
      return (await tm.timeline({ cwd: root, env: process.env })).checkpoints.length;
    } catch {
      return 0;
    }
  }

  /** Points a moved project at its new folder. Its history moves with it in the store. */
  private relinkProject(projectId: string, input: string): Promise<ProjectEntry> {
    const p = this.state.find(projectId);
    if (!p) throw new tm.TmError("not_found", "That project is no longer in the list.");
    const path = folderAt(input);
    const other = this.state.reload().find((x) => x.id !== p.id && x.path === path);
    if (other) throw new tm.TmError("usage", `That folder is already in the list as ${other.name}.`);
    return this.serial(p.id, "Moving the history", async () => {
      const moved = await tm.relinkProject(this.ctx(p), path);
      const entry = this.state.updateProject(p.id, (x) => ({ ...x, path: moved.root, name: basename(moved.root), kind: moved.kind }));
      if (!entry) throw new tm.TmError("not_found", "That project is no longer in the list.");
      this.allowedPaths.add(moved.root);
      this.autoSaveErrors.delete(p.id);
      this.syncAutoSave();
      return entry;
    });
  }

  private get platform(): NodeJS.Platform {
    return this.services.platform ?? process.platform;
  }

  /** The Mac's folder chooser. Null when the person cancels (osascript exits 1). */
  private async pickFolder(): Promise<string | null> {
    if (this.platform !== "darwin") throw new tm.TmError("usage", "The folder chooser needs a Mac. Type the folder's path instead.");
    const r = await (this.services.exec ?? nodeExec)("osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose a folder to protect")'], 120_000);
    if (r.code === 1) return null;
    if (r.code === null) throw new tm.TmError("usage", "The folder chooser closed after 2 minutes. Try again, or type the folder's path.");
    const path = r.stdout.trim();
    if (r.code !== 0 || !path.startsWith("/")) throw new tm.TmError("usage", "The folder chooser did not open. Type the folder's path instead.");
    // osascript ends a folder with a slash.
    return path.length > 1 ? path.replace(/\/+$/, "") : path;
  }

  /** Shows `path` in Finder. Only paths inside the home folder or the system temp folder, links followed first. */
  private async reveal(path: string): Promise<true> {
    if (this.platform !== "darwin") throw new tm.TmError("usage", "Showing a file in Finder needs a Mac.");
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      throw new tm.TmError("not_found", `${path} is not there anymore.`);
    }
    const roots = [homedir(), tmpdir()].flatMap((r) => (existsSync(r) ? [realpathSync(r)] : []));
    if (!roots.some((r) => isInside(real, r))) throw new tm.TmError("usage", "Only files in your home folder or the temp folder can be shown in Finder.");
    const r = await (this.services.exec ?? nodeExec)("open", ["-R", real], 10_000);
    if (r.code !== 0) throw new tm.TmError("usage", `Finder did not open. The path is ${real}.`);
    return true;
  }

  /** The hook lines for this project, with the first command that answers `--version` with this version. */
  async hookPreview(p: ProjectEntry): Promise<HookPreview> {
    const { command, runs } = await firstRunning(this.hook.candidates, (c) => tm.probeHookCommand(c, this.hook.version, p.path, process.env));
    return {
      settingsPath: join(p.path, ".claude", "settings.json"),
      command,
      runs,
      plugin: tm.claudePluginStatus(this.ctx(p)).enabled,
      lines: [
        { event: "UserPromptSubmit", command: `${command} hook prompt` },
        { event: "PreToolUse (Bash)", command: `${command} hook pre-bash` },
        { event: "Stop", command: `${command} hook stop` },
      ],
    };
  }

  /**
   * Size on disk per project store, and the whole store (every project, removed ones too, and the
   * app's own files). A Git project also keeps its save points in its own .git folder: that is
   * described in `note`, not counted.
   */
  storage(): StorageResult {
    const rows = this.state.projects.map((p) => {
      let storeDir = "";
      let bytes = 0;
      try {
        storeDir = tm.storeDirFor(this.ctx(p));
        bytes = existsSync(storeDir) ? dirSize(storeDir) : 0;
      } catch {
        // A moved project still shows, with no size.
      }
      return { projectId: p.id, name: p.name, bytes, storeDir };
    });
    const home = storeHome();
    const git = this.state.projects.filter((p) => p.kind === "git").map((p) => p.name);
    const note = git.length
      ? `Code projects (${git.join(", ")}) also keep their save points inside the project's own .git folder. That space is not counted here.`
      : null;
    return { rows, storeBytes: existsSync(home) ? dirSize(home) : 0, storeDir: home, note };
  }

  /** Projects with history in the store that this app does not list, such as ones set up with tm init. */
  storeProjects(): StoreProject[] {
    const listed = new Set(this.state.reload().map((p) => p.path));
    return tm
      .storeProjects({ cwd: process.cwd(), env: process.env })
      .filter((s) => !listed.has(s.root))
      .map((s) => ({ path: s.root, name: s.name, kind: s.kind, savePoints: s.savePoints, lastSaved: s.lastSaved, bytes: s.sizeBytes, exists: !s.missing }));
  }

  /**
   * Claude Code connection per project. Never writes. Our lines in .claude/settings.json come first: they are looked
   * up for each command the app could have written, and "connected" needs the command to answer, so a missing CLI
   * shows as connected but not running. Without lines, the Claude Code plugin counts when it is installed and on for
   * this project; it acts only once this computer approved the check, and only when the tm on PATH is Time Machine.
   */
  async agents(): Promise<AgentRow[]> {
    return Promise.all(
      this.state.projects.map(async (p): Promise<AgentRow> => {
        const base = { projectId: p.id, name: p.name };
        try {
          if (!existsSync(p.path)) throw new Error("moved");
          const ctx = this.ctx(p);
          let s: tm.HookStatusResult | null = null;
          for (const command of this.hook.candidates) {
            s = await tm.hookStatus(ctx, { command, version: this.hook.version });
            if (!s.readable || s.present.length) break;
          }
          if (!s) throw new Error("no hook command");
          const since = agentTurnStart((await tm.log(ctx)).entries, Date.now());
          const plugin = tm.claudePluginStatus(ctx);
          const status = tm.status(ctx);
          const row = { ...base, settingsPath: s.settingsPath, missing: s.missing, working: since !== null, workingSince: since, check: status.check, pluginOff: plugin.installed && !plugin.enabled };
          if (s.state !== "not-connected" || !plugin.enabled) return { ...row, claudeCode: s.state, via: s.present.length ? "settings" : null };
          const claudeCode = !status.approved ? "needs-approval" : (await tm.probePluginTm(process.env)) ? "connected" : "not-running";
          return { ...row, claudeCode, via: "plugin", missing: [] };
        } catch {
          return { ...base, claudeCode: "unavailable", via: null, pluginOff: false, check: null, settingsPath: null, missing: [], working: false, workingSince: null };
        }
      }),
    );
  }

  private sandboxName: string | null | undefined;

  /** Detecting the sandbox runs a tiny command, so it is done once per session. */
  isolation(): IsolationInfo {
    if (this.sandboxName === undefined) this.sandboxName = tm.detectSandbox(process.env)?.name ?? null;
    return { mode: "host", networkSandbox: this.sandboxName };
  }

  async run(call: EngineCall): Promise<Res<Results[EngineCall["method"]]>> {
    try {
      return { ok: true, data: await this.dispatch(call) };
    } catch (e) {
      const denied = storeDenied(e);
      if (denied) return { ok: false, error: { kind: "permission", message: denied } };
      if (e instanceof tm.TmError) return { ok: false, error: { kind: e.kind, message: e.message } };
      return { ok: false, error: { kind: "internal", message: e instanceof Error ? e.message : String(e) } };
    }
  }

  private async dispatch(call: EngineCall): Promise<Results[EngineCall["method"]]> {
    switch (call.method) {
      case "statuses":
        return Promise.all(this.state.projects.map((p) => this.status(p)));
      case "addProject":
        return this.addProject(call.path, false, call.purpose);
      case "previewProject":
        return this.previewProject(call.path);
      case "setPurpose": {
        // Works for a moved project too: it only changes the app's words.
        const p = this.state.updateProject(call.projectId, (x) => ({ ...x, purpose: call.purpose }));
        if (!p) throw new tm.TmError("not_found", "That project is no longer in the list.");
        return p;
      }
      case "sources":
        // Checks whether well-known folders under the home folder exist. Reads no file.
        return tm.sources();
      case "removeProject": {
        // Only forgets the project in the app. Its save points stay in the store. With dropSettings (Back in the Add flow),
        // the settings file this app's own init wrote into the folder in this session goes too, if it is still exactly as
        // the app last wrote it; a file that was there, or one someone edited since, stays.
        const made = this.madeSettings.get(call.projectId);
        this.madeSettings.delete(call.projectId);
        const left = this.state.updateProjects((list) => list.filter((p) => p.id !== call.projectId));
        this.syncAutoSave();
        if (call.dropSettings && made && fileMark(made.path) === made.mark) {
          try {
            rmSync(made.path);
          } catch {
            // Already gone or not ours to remove: the project is out of the list either way.
          }
        }
        return left;
      }
      case "storeProjects":
        return this.storeProjects();
      case "demo": {
        const result = await tm.demo({ cwd: tmpdir(), env: process.env });
        const project = await this.addProject(result.dir, true);
        for (const x of [result.dir, result.recover.copyDir, result.recover.reportPath]) this.allowedPaths.add(x);
        return { project, result };
      }
      case "storage":
        return this.storage();
      case "agents":
        return this.agents();
      case "isolation":
        return this.isolation();
      case "readReport": {
        if (!this.allowedPaths.has(call.path) || !call.path.endsWith(".md")) throw new tm.TmError("usage", "That report is not one this app made.");
        return readFileSync(call.path, "utf8");
      }
      case "setFeature": {
        // Works for a moved project too, so a feature can always be turned off.
        const c = call.change;
        // Turning Ask on, or linking a Vercel project, records what was agreed: when and which text (for Ask, also the
        // service the keys point at now). Turning it off or unlinking keeps that record, so the last agreement can be shown.
        const at = new Date().toISOString();
        const askConsent = c.feature === "ask" && c.enabled ? { at, version: ASK_CONSENT_VERSION, provider: this.services.credentials.status().provider } : undefined;
        const vercelConsent = c.feature === "vercel" && c.link ? { at, version: VERCEL_CONSENT_VERSION } : undefined;
        const p = this.state.updateProject(call.projectId, (x) => ({
          ...x,
          features:
            c.feature === "ask"
              ? { ...x.features, ask: c.enabled, ...(askConsent ? { askConsent } : {}) }
              : c.feature === "vercel"
                ? { ...x.features, vercel: c.link, ...(vercelConsent ? { vercelConsent } : {}) }
                : { ...x.features, autoSave: c.autoSave },
        }));
        if (!p) throw new tm.TmError("not_found", "That project is no longer in the list.");
        if (c.feature === "vercel") this.vercel.forget();
        this.syncAutoSave();
        return p;
      }
      case "credentials":
        return this.services.credentials.status();
      case "setCredential":
        this.services.credentials.set(call.name, call.value);
        if (call.name === "vercel") this.vercel.forget();
        return { configured: this.services.credentials.status()[call.name] };
      case "vercelProjects":
        return this.vercel.projects();
      case "license":
        return this.license();
      case "setLicense":
        return tm.activateLicense(this.licenseCtx(), call.key, this.services.licensePublicKey);
      case "removeLicense":
        return tm.removeLicense(this.licenseCtx());
      case "siteStatus":
        return this.account.siteStatus();
      case "signIn":
        return this.account.signIn(call.email, { agreed: call.agreed, termsVersion: call.termsVersion, privacyVersion: call.privacyVersion, boxVersion: call.boxVersion });
      case "verifyCode":
        return this.account.verifyCode(call.email, call.code, { agreed: call.agreed, termsVersion: call.termsVersion, privacyVersion: call.privacyVersion, boxVersion: call.boxVersion });
      case "accountLicenses":
        return this.account.accountLicenses();
      case "signOut":
        return this.account.signOut();
      case "sendFeedback":
        return this.sendFeedback(call.answers);
      case "stopCheck": {
        // Never queued behind the check it stops. False when nothing was running.
        const c = this.stops.get(call.projectId);
        c?.abort();
        return !!c;
      }
      case "pickFolder":
        return { path: await this.pickFolder() };
      case "reveal":
        return this.reveal(call.path);
      case "relinkProject":
        return this.relinkProject(call.projectId, call.path);
      default:
        break;
    }
    // A moved folder's history can still be read, copied out and brought back from the store.
    const p = this.project(call.projectId, MISSING_OK[call.method] === true);
    const ctx = this.ctx(p);
    switch (call.method) {
      case "projectConfig":
        return pickCheckConfig(tm.projectConfig(ctx));
      case "setProjectConfig":
        // Compare and set: with ifCommand, core makes the change only while the file exists and its command is still
        // that one, checked on the text it is about to edit (Security N2, R3).
        return this.serial(p.id, "Saving the check settings", async () =>
          pickCheckConfig(await this.ownWrite(p.id, () => tm.setProjectConfig(ctx, call.patch, call.ifCommand !== undefined ? { ifCommand: call.ifCommand } : {}))),
        );
      case "timeline":
        return tm.timeline(ctx);
      case "notes":
        return tm.notes(ctx);
      case "thinPreview":
        return tm.thinPreview(ctx);
      case "thinApply":
        // Queued, so it never runs beside a save, check or rewind. Core re-runs the preview and refuses any other id.
        return this.serial(p.id, "Thinning old auto saves", () => tm.thinApply(ctx, call.ids));
      case "setNote":
        // Not queued behind a running check: a note is one small file in the store, written atomically.
        return tm.setNote(ctx, { id: call.id, title: call.title, note: call.note, pinned: call.pinned });
      case "deployments": {
        // Nothing is read from Vercel unless the link was made under the current read-only note.
        const link = p.features.vercel;
        if (!link || !vercelConsentValid(p.features)) return null;
        const [read, t] = await Promise.all([this.vercel.deployments(link), tm.timeline(ctx)]);
        return matchDeployments(link, t.checkpoints, read.value, new Date(read.at).toISOString());
      }
      case "ask": {
        const { credentials } = this.services;
        const model = process.env.TM_ASK_MODEL?.trim();
        const answer = await askHistory(p, ctx, call.question, { key: credentials.get("gemini"), anthropicKey: credentials.get("anthropic"), ...(model ? { anthropicModel: model } : {}), fetch: this.services.fetch });
        // Only an answered Ask counts toward the survey (shared/pmf.ts). A count that can't be saved never fails the answer.
        try {
          this.emit({ type: "settings", settings: this.state.countAsk() });
        } catch {
          // The answer still shows; the survey just counts this Ask late or not at all.
        }
        return answer;
      }
      case "diff":
        return tm.diff(ctx, call.a, call.b);
      case "log":
        return tm.log(ctx);
      case "hookPreview":
        return this.hookPreview(p);
      case "init":
        return this.serial(p.id, "Setting up", async () => {
          const r = await tm.init(ctx);
          const mark = r.created && r.kind === "git" ? fileMark(r.configPath) : null;
          if (mark) this.madeSettings.set(p.id, { path: r.configPath, mark });
          return r;
        });
      case "setCheck":
        return this.serial(p.id, "Saving the check", () => this.ownWrite(p.id, () => tm.setCheck(ctx, call.command)));
      case "checkpoint":
        return this.serial(p.id, "Saving", () =>
          tm.checkpoint(ctx, { note: call.note?.trim() || "Saved from the app", trigger: "app", skipIfUnchanged: call.ifChanged ?? false }),
        );
      case "verify":
        return this.serial(p.id, "Checking", () => this.stoppable(p.id, async (signal) => {
          const r = await tm.verify(ctx, call.id, { signal });
          if (r.log) this.allowedPaths.add(r.log);
          return r;
        }));
      case "checkLogTail":
        // Read only, so it never waits behind a running check. Core picks the file by the save point id.
        return tm.checkLogTail(ctx, call.id);
      case "checkRecord":
        // Read only, so it never waits behind a running check. Core returns only that id's sealed record, cleaned.
        return tm.checkRecord(ctx, call.id);
      case "open":
        return this.serial(p.id, "Making a safe copy", async () => {
          const r = await tm.open(ctx, call.id);
          this.allowedPaths.add(r.dir);
          return r;
        });
      case "findGood":
        return this.serial(p.id, "Finding the last working version", () => this.stoppable(p.id, (signal) => tm.findGood(ctx, { signal })));
      case "recover":
        return this.serial(p.id, p.kind === "folder" ? "Making a recovery copy" : "Preparing the recovery branch", async () => {
          const r = await tm.recover(ctx, call.id, call.dest === undefined ? undefined : { dest: call.dest });
          this.allowedPaths.add(r.copyDir);
          this.allowedPaths.add(r.reportPath);
          return r;
        });
      case "restorePaths":
        return this.serial(p.id, "Putting files back", () => tm.restorePaths(ctx, call.id, call.paths, call.dryRun ? { dryRun: true } : {}));
      case "undoRecover": {
        // Core refuses anything that is not this exact recovery copy. The app also only passes on
        // a copy it made in this session.
        const { copyDir } = call;
        if (!this.allowedPaths.has(copyDir)) throw new tm.TmError("usage", `${copyDir} is not a recovery copy this app made, so it was left alone.`);
        return this.serial(p.id, "Undoing the rewind", async () => {
          const r = await tm.undoRecover(ctx, { id: call.id, branch: call.branch, copyDir });
          this.allowedPaths.delete(copyDir);
          return r;
        });
      }
      case "hookInstall":
        return this.serial(p.id, "Connecting Claude Code", async () => {
          const h = await this.hookPreview(p);
          if (!h.runs) {
            throw new tm.TmError("usage", `The hook command does not run on this computer yet (${h.command} --version did not answer ${this.hook.version}), so nothing was added. From a source checkout, run pnpm build first.`);
          }
          return tm.hookInstall(ctx, { command: h.command });
        });
      case "forget":
        // tm forget: the check's approval and our hook lines go; other tools' hooks and the save points stay.
        return this.serial(p.id, "Disconnecting Claude Code", async () => tm.forget(ctx));
      case "cleanStore":
        if (!call.apply) return tm.cleanStore(ctx, { apply: false });
        return this.serial(p.id, "Cleaning up", () => tm.cleanStore(ctx, { apply: true, files: call.files ?? [] }));
    }
  }
}

/** Per-project methods that work while the folder is missing: they read or copy out of the store only. */
const MISSING_OK: Partial<Record<EngineCall["method"], true>> = {
  timeline: true, notes: true, log: true, diff: true, open: true, recover: true, checkLogTail: true, checkRecord: true, projectConfig: true,
};

function pickCheckConfig(c: ProjectCheckConfig): ProjectCheckConfig {
  return { command: c.command, setup: c.setup, timeoutSeconds: c.timeoutSeconds, network: c.network, maxFileMB: c.maxFileMB };
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) total += dirSize(full);
    else if (e.isFile()) total += statSync(full).size;
  }
  return total;
}

/** The Time Machine store: $TM_HOME, or ~/.timemachine. */
function storeHome(): string {
  return resolve(process.env.TM_HOME ?? join(homedir(), ".timemachine"));
}

/** A typed folder path: trimmed, with a leading ~ meaning the home folder. Refuses empty and relative paths. */
export function expandPath(input: string): string {
  const s = input.trim();
  if (!s) throw new tm.TmError("usage", "Enter a folder path.");
  const path = s === "~" ? homedir() : s.startsWith("~/") ? join(homedir(), s.slice(2)) : s;
  if (!isAbsolute(path)) throw new tm.TmError("usage", "Enter the whole path to the folder, starting with / or ~/.");
  return resolve(path);
}

function missingSentence(p: ProjectEntry): string {
  return `We can't find ${p.name} at ${p.path}. Its history is safe in the store.`;
}

function storeDeniedSentence(): string {
  return `Time Machine can't write to its store at ${storeHome()}. Check the folder's permissions.`;
}

/** True when this user can write the store, or it does not exist yet (it is made on first save). */
function storeWritable(): boolean {
  const home = storeHome();
  try {
    accessSync(existsSync(home) ? home : dirname(home), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The sentence for a failure caused by a store this user can't write, or null. A refused write in the store
 * says so directly; Git and other tools say it in their own words, so any failure while the store can't be
 * written counts too, except a plain usage or not-found answer, which stands.
 */
function storeDenied(e: unknown): string | null {
  const err = e as NodeJS.ErrnoException | null;
  const code = err?.code;
  if ((code === "EACCES" || code === "EPERM" || code === "EROFS") && typeof err?.path === "string" && isInside(err.path, storeHome())) return storeDeniedSentence();
  if (e instanceof tm.TmError && (e.kind === "usage" || e.kind === "not_found")) return null;
  return storeWritable() ? null : storeDeniedSentence();
}

function isInside(path: string, dir: string): boolean {
  const d = relative(dir, resolve(path));
  return d === "" || (!d.startsWith("..") && !isAbsolute(d));
}

/** The folder a typed path names, checked: it exists, is a folder, and this user can list it. */
function folderAt(input: string): string {
  const path = expandPath(input);
  if (!existsSync(path)) throw new tm.TmError("usage", "That folder does not exist.");
  if (!statSync(path).isDirectory()) throw new tm.TmError("usage", "That is a file, not a folder.");
  // Without this, a folder with no read permission would be reported as "not inside a Git repository".
  try {
    opendirSync(path).closeSync();
  } catch {
    throw new tm.TmError("usage", `Time Machine can't read ${path}. Check the folder's permissions, then try again.`);
  }
  return path;
}

/** A file's identity and content: device, inode and the hash of its bytes, read through one descriptor that never follows a
 *  link or waits on a pipe (Security N3). Null when it is not a plain file or can't be read. */
function fileMark(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    return `${st.dev}:${st.ino}:${createHash("sha256").update(readFileSync(fd)).digest("hex")}`;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** Script names in the folder's package.json. Empty when there is none or it can't be read. */
function packageScripts(root: string): string[] {
  try {
    const r = PackageScripts.safeParse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
    return r.success ? Object.keys(r.data.scripts ?? {}) : [];
  } catch {
    return [];
  }
}
