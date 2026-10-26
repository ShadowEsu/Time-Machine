// Runs validated calls against the one engine, @timetm/core. The CLI calls the same
// functions, so the app and the CLI can never disagree.
import { randomUUID } from "node:crypto";
import { existsSync, opendirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import * as tm from "@timetm/core";
import type { AgentRow, Call, HookPreview, IsolationInfo, LicenseStatus, ProjectEntry, ProjectStatus, Purpose, Res, Results, StorageRow } from "../shared/api.js";
import { PRICING_URL } from "../shared/links.js";
import { Account, siteFromEnv } from "./account.js";
import { askHistory } from "./ask.js";
import { AutoSaver, type AutoSaveDeps } from "./autosave.js";
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

/** What the opt-in features reach outside this computer with. Tests pass a fake fetch and their own license key pair. */
export interface Services {
  credentials: Credentials;
  fetch: typeof fetch;
  /** The seller's public key that license keys are checked against. Tests pass a generated one. */
  licensePublicKey?: string;
  /** Auto save timing and watching. Tests pass short times and a fake watcher. */
  autoSave?: Omit<AutoSaveDeps, "save" | "busy">;
}

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

  constructor(
    private readonly state: AppState,
    private readonly hook: HookSetup,
    private readonly services: Services,
  ) {
    for (const p of state.projects) this.allowedPaths.add(p.path);
    const store = resolve(process.env.TM_HOME ?? join(homedir(), ".timemachine"));
    this.autoSaver = new AutoSaver({
      ignoreDirs: [store],
      ...services.autoSave,
      busy: (id) => this.busy.has(id),
      save: (id) => this.autoSave(id),
    });
    this.syncAutoSave();
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
   * One auto save: queued like any other action, and skipped when nothing changed. A failure becomes the
   * project's problem in statuses, and each new error message gets one autosave-failed audit entry.
   */
  private autoSave(projectId: string): Promise<unknown> {
    const p = this.state.find(projectId);
    if (!p || !existsSync(p.path)) return Promise.resolve(null);
    return this.serial(p.id, "Auto saving", () => tm.checkpoint(this.ctx(p), { note: "Auto save", trigger: "auto", skipIfUnchanged: true })).then(
      (r) => {
        this.autoSaveErrors.delete(p.id);
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

  private project(id: string): ProjectEntry {
    const p = this.state.find(id);
    if (!p) throw new tm.TmError("not_found", "That project is no longer in the list.");
    if (!existsSync(p.path)) throw new tm.TmError("not_found", `We can't find ${p.name} at ${p.path}. Its history is safe in the store.`);
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

  async status(p: ProjectEntry): Promise<ProjectStatus> {
    try {
      const t = await tm.timeline(this.ctx(p));
      const last = t.checkpoints.at(-1);
      const working = [...t.checkpoints].reverse().find((c) => c.verdict === "PASS" && c.id !== last?.id) ?? null;
      return {
        projectId: p.id,
        newest: last ? { id: last.id, verdict: last.verdict, createdAt: last.createdAt } : null,
        lastWorking: working ? { id: working.id, createdAt: working.createdAt, note: working.note } : null,
        problem: this.autoSaveErrors.has(p.id) ? `Auto save failed: ${this.autoSaveErrors.get(p.id)}` : null,
      };
    } catch (e) {
      return { projectId: p.id, newest: null, lastWorking: null, problem: e instanceof Error ? e.message : String(e) };
    }
  }

  async addProject(path: string, demo = false, purpose?: Purpose): Promise<ProjectEntry> {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new tm.TmError("usage", "That folder does not exist.");
    // Without this, a folder with no read permission would be reported as "not inside a Git repository".
    try {
      opendirSync(path).closeSync();
    } catch {
      throw new tm.TmError("usage", `Time Machine can't read ${path}. Check the folder's permissions, then try again.`);
    }
    // The engine resolves the project, so the app and the CLI agree on which one this is: the Git
    // repository around the folder, or else the folder itself as a plain folder project.
    const ctx = { cwd: path, env: process.env };
    const planned = tm.protect(ctx, { dryRun: true });
    const existing = this.state.projects.find((p) => p.path === planned.root);
    if (existing) return existing;
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
    this.state.projects.push(entry);
    this.state.saveProjects();
    this.allowedPaths.add(root);
    this.syncAutoSave();
    return entry;
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

  storage(): StorageRow[] {
    return this.state.projects.map((p) => {
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
      case "setPurpose": {
        // Works for a moved project too: it only changes the app's words.
        const p = this.state.find(call.projectId);
        if (!p) throw new tm.TmError("not_found", "That project is no longer in the list.");
        p.purpose = call.purpose;
        this.state.saveProjects();
        return p;
      }
      case "sources":
        // Checks whether well-known folders under the home folder exist. Reads no file.
        return tm.sources();
      case "removeProject": {
        // Only forgets the project in the app. Its save points stay in the store.
        this.state.projects = this.state.projects.filter((p) => p.id !== call.projectId);
        this.state.saveProjects();
        this.syncAutoSave();
        return this.state.projects;
      }
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
        const p = this.state.find(call.projectId);
        if (!p) throw new tm.TmError("not_found", "That project is no longer in the list.");
        const c = call.change;
        if (c.feature === "ask") p.features = { ...p.features, ask: c.enabled };
        else if (c.feature === "vercel") {
          p.features = { ...p.features, vercel: c.link };
          this.vercel.forget();
        } else p.features = { ...p.features, autoSave: c.autoSave };
        this.state.saveProjects();
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
        return this.account.signIn(call.email);
      case "verifyCode":
        return this.account.verifyCode(call.email, call.code);
      case "accountLicenses":
        return this.account.accountLicenses();
      case "signOut":
        return this.account.signOut();
      case "stopCheck": {
        // Never queued behind the check it stops. False when nothing was running.
        const c = this.stops.get(call.projectId);
        c?.abort();
        return !!c;
      }
      default:
        break;
    }
    const p = this.project(call.projectId);
    const ctx = this.ctx(p);
    switch (call.method) {
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
        const link = p.features.vercel;
        if (!link) return null;
        const [read, t] = await Promise.all([this.vercel.deployments(link), tm.timeline(ctx)]);
        return matchDeployments(link, t.checkpoints, read.value, new Date(read.at).toISOString());
      }
      case "ask":
        return askHistory(p, ctx, call.question, { key: this.services.credentials.get("gemini"), fetch: this.services.fetch });
      case "diff":
        return tm.diff(ctx, call.a, call.b);
      case "log":
        return tm.log(ctx);
      case "hookPreview":
        return this.hookPreview(p);
      case "init":
        return this.serial(p.id, "Setting up", () => tm.init(ctx));
      case "setCheck":
        return this.serial(p.id, "Saving the check", () => tm.setCheck(ctx, call.command));
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
          const r = await tm.recover(ctx, call.id);
          this.allowedPaths.add(r.copyDir);
          this.allowedPaths.add(r.reportPath);
          return r;
        });
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
      case "cleanStore":
        if (!call.apply) return tm.cleanStore(ctx, { apply: false });
        return this.serial(p.id, "Cleaning up", () => tm.cleanStore(ctx, { apply: true, files: call.files ?? [] }));
    }
  }
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
