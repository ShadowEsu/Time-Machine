// Runs validated calls against the one engine, @timetm/core. The CLI calls the same
// functions, so the app and the CLI can never disagree.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as tm from "@timetm/core";
import type { Call, HookPreview, ProjectEntry, ProjectStatus, Res, Results, StorageRow } from "../shared/api.js";
import type { AppState } from "./state.js";

type EngineCall = Exclude<Call, { method: "bootstrap" | "chooseFolder" | "setSettings" | "reveal" | "copy" | "setActive" }>;

export class Engine {
  /** Paths the engine handed back in this session. Only these can be revealed or read. */
  readonly allowedPaths = new Set<string>();
  /** Projects with an engine action running right now. */
  readonly busy = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly state: AppState) {
    for (const p of state.projects) this.allowedPaths.add(p.path);
  }

  ctx(p: ProjectEntry): tm.Ctx {
    return { cwd: p.path, env: process.env };
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

  async status(p: ProjectEntry): Promise<ProjectStatus> {
    try {
      const t = await tm.timeline(this.ctx(p));
      const last = t.checkpoints.at(-1);
      const working = [...t.checkpoints].reverse().find((c) => c.verdict === "PASS" && c.id !== last?.id) ?? null;
      return {
        projectId: p.id,
        newest: last ? { id: last.id, verdict: last.verdict } : null,
        lastWorking: working ? { id: working.id, createdAt: working.createdAt, note: working.note } : null,
        problem: null,
      };
    } catch (e) {
      return { projectId: p.id, newest: null, lastWorking: null, problem: e instanceof Error ? e.message : String(e) };
    }
  }

  async addProject(path: string, demo = false): Promise<ProjectEntry> {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new tm.TmError("usage", "That folder does not exist.");
    // The engine resolves the Git root, so the app and the CLI agree on which project this is.
    const root = (await tm.timeline({ cwd: path, env: process.env })).project;
    const existing = this.state.projects.find((p) => p.path === root);
    if (existing) return existing;
    const entry: ProjectEntry = { id: randomUUID(), path: root, name: basename(root), addedAt: new Date().toISOString(), demo };
    this.state.projects.push(entry);
    this.state.saveProjects();
    this.allowedPaths.add(root);
    return entry;
  }

  hookPreview(p: ProjectEntry): HookPreview {
    const command = process.env.TM_HOOK_COMMAND ?? "npx -y timetm";
    return {
      settingsPath: join(p.path, ".claude", "settings.json"),
      command,
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
      case "readReport": {
        if (!this.allowedPaths.has(call.path) || !call.path.endsWith(".md")) throw new tm.TmError("usage", "That report is not one this app made.");
        return readFileSync(call.path, "utf8");
      }
      default:
        break;
    }
    const p = this.project(call.projectId);
    const ctx = this.ctx(p);
    switch (call.method) {
      case "timeline":
        return tm.timeline(ctx);
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
        return this.serial(p.id, "Checking", async () => {
          const r = await tm.verify(ctx, call.id);
          if (r.log) this.allowedPaths.add(r.log);
          return r;
        });
      case "open":
        return this.serial(p.id, "Making a safe copy", async () => {
          const r = await tm.open(ctx, call.id);
          this.allowedPaths.add(r.dir);
          return r;
        });
      case "findGood":
        return this.serial(p.id, "Finding the last working version", () => tm.findGood(ctx));
      case "recover":
        return this.serial(p.id, "Preparing the recovery branch", async () => {
          const r = await tm.recover(ctx, call.id);
          this.allowedPaths.add(r.copyDir);
          this.allowedPaths.add(r.reportPath);
          return r;
        });
      case "hookInstall":
        return this.serial(p.id, "Connecting Claude Code", () => tm.hookInstall(ctx, { command: this.hookPreview(p).command }));
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
