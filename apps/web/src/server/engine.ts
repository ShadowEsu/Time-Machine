// Runs validated calls against the one engine, @timetm/core. The CLI calls the same
// functions, so the app and the CLI can never disagree.
import { randomUUID } from "node:crypto";
import { existsSync, opendirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as tm from "@timetm/core";
import type { AgentRow, Call, HookPreview, IsolationInfo, LicenseStatus, ProjectEntry, ProjectStatus, Res, Results, StorageRow } from "../shared/api.js";
import { PRICING_URL } from "../shared/links.js";
import { askHistory } from "./ask.js";
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

  constructor(
    private readonly state: AppState,
    private readonly hook: HookSetup,
    private readonly services: Services,
  ) {
    for (const p of state.projects) this.allowedPaths.add(p.path);
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
        problem: null,
      };
    } catch (e) {
      return { projectId: p.id, newest: null, lastWorking: null, problem: e instanceof Error ? e.message : String(e) };
    }
  }

  async addProject(path: string, demo = false): Promise<ProjectEntry> {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new tm.TmError("usage", "That folder does not exist.");
    // Without this, a folder with no read permission would be reported as "not inside a Git repository".
    try {
      opendirSync(path).closeSync();
    } catch {
      throw new tm.TmError("usage", `Time Machine can't read ${path}. Check the folder's permissions, then try again.`);
    }
    // The engine resolves the Git root, so the app and the CLI agree on which project this is.
    const root = (await tm.timeline({ cwd: path, env: process.env })).project;
    const existing = this.state.projects.find((p) => p.path === root);
    if (existing) return existing;
    // The free app lists a few projects. The demo is never refused; it counts like any other project after.
    const license = this.license();
    if (!demo && !license.active && this.state.projects.length >= license.freeProjectLimit) {
      throw new tm.TmError("usage", `The free web app lists up to ${license.freeProjectLimit} projects. Remove one, or buy Time Machine once for $50 at ${PRICING_URL} to add more. Every restore stays free.`);
    }
    const entry: ProjectEntry = { id: randomUUID(), path: root, name: basename(root), addedAt: new Date().toISOString(), demo, features: { ask: false, vercel: null } };
    this.state.projects.push(entry);
    this.state.saveProjects();
    this.allowedPaths.add(root);
    return entry;
  }

  /** The hook lines for this project, with the first command that answers `--version` with this version. */
  async hookPreview(p: ProjectEntry): Promise<HookPreview> {
    const { command, runs } = await firstRunning(this.hook.candidates, (c) => tm.probeHookCommand(c, this.hook.version, p.path, process.env));
    return {
      settingsPath: join(p.path, ".claude", "settings.json"),
      command,
      runs,
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
   * Claude Code connection per project, read from its .claude/settings.json. Never writes.
   * The lines are looked up for each command the app could have written, and "connected"
   * needs the command to answer, so a missing CLI shows as connected but not running.
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
          return { ...base, claudeCode: s.state, settingsPath: s.settingsPath, missing: s.missing, working: since !== null, workingSince: since };
        } catch {
          return { ...base, claudeCode: "unavailable", settingsPath: null, missing: [], working: false, workingSince: null };
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
        return this.addProject(call.path);
      case "removeProject": {
        // Only forgets the project in the app. Its save points stay in the store.
        this.state.projects = this.state.projects.filter((p) => p.id !== call.projectId);
        this.state.saveProjects();
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
        p.features = c.feature === "ask" ? { ...p.features, ask: c.enabled } : { ...p.features, vercel: c.link };
        if (c.feature === "vercel") this.vercel.forget();
        this.state.saveProjects();
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
      case "open":
        return this.serial(p.id, "Making a safe copy", async () => {
          const r = await tm.open(ctx, call.id);
          this.allowedPaths.add(r.dir);
          return r;
        });
      case "findGood":
        return this.serial(p.id, "Finding the last working version", () => this.stoppable(p.id, (signal) => tm.findGood(ctx, { signal })));
      case "recover":
        return this.serial(p.id, "Preparing the recovery branch", async () => {
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
