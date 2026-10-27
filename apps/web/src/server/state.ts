// Projects and settings the app remembers, kept as JSON in the app's userData folder.
// Both files are validated with Zod on every read. A broken file is set aside, not trusted.
// Every write re-reads the file first and replaces it in one rename, so a change made by the CLI or
// another window in between is kept, and a reader never sees half a file.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import * as tm from "@timetm/core";
import { z } from "zod";
import { ProjectEntrySchema, SettingsSchema, type ProjectEntry, type Settings } from "../shared/api.js";

const ProjectsFileSchema = z.strictObject({ version: z.literal(1), projects: z.array(ProjectEntrySchema) });

function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    const r = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (r.success) return r.data;
  } catch {
    // Falls through to setting the file aside.
  }
  renameSync(path, `${path}.broken-${Date.now()}`);
  return fallback;
}

/** Writes a temp file of its own and renames it over `path`, so two writers never share a temp file. */
function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export class AppState {
  private readonly projectsPath: string;
  private readonly settingsPath: string;
  projects: ProjectEntry[];
  settings: Settings;
  /** The project the user looked at last. Store change events name it. */
  activeId: string | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.projectsPath = join(dir, "projects.json");
    this.settingsPath = join(dir, "settings.json");
    this.projects = this.readProjects();
    this.settings = readJson(this.settingsPath, SettingsSchema, SettingsSchema.parse({}));
    this.activeId = this.projects[0]?.id ?? null;
  }

  private readProjects(): ProjectEntry[] {
    return readJson(this.projectsPath, ProjectsFileSchema, { version: 1 as const, projects: [] }).projects;
  }

  /** Reads projects.json again, for a change another window or the CLI made. */
  reload(): ProjectEntry[] {
    this.projects = this.readProjects();
    return this.projects;
  }

  /** Re-reads projects.json, applies `change` to what is on disk, and writes the result in one rename. */
  updateProjects(change: (projects: ProjectEntry[]) => ProjectEntry[]): ProjectEntry[] {
    const next = change(this.readProjects());
    writeJson(this.projectsPath, { version: 1, projects: next });
    this.projects = next;
    return next;
  }

  /** Changes one project as it is on disk now. Null when it is no longer in the list. */
  updateProject(id: string, change: (p: ProjectEntry) => ProjectEntry): ProjectEntry | null {
    let found: ProjectEntry | null = null;
    this.updateProjects((list) => list.map((p) => (p.id === id ? (found = change(p)) : p)));
    return found;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const current = readJson(this.settingsPath, SettingsSchema, this.settings);
    const next = SettingsSchema.parse({ ...current, ...defined });
    writeJson(this.settingsPath, next);
    this.settings = next;
    return this.settings;
  }

  find(id: string): ProjectEntry | null {
    return this.projects.find((p) => p.id === id) ?? null;
  }

  active(): ProjectEntry | null {
    return (this.activeId ? this.find(this.activeId) : null) ?? this.projects[0] ?? null;
  }
}

/** `boot`: the computer's boot ID when the lock was written, where the system has one. `nonce`: this start's own value, so
 *  two locks never read the same (R4). Older locks have neither. */
const LockSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535).nullable(),
  boot: z.string().min(1).max(100).optional(),
  nonce: z.string().min(1).max(100).optional(),
});
type Lock = z.infer<typeof LockSchema>;

/** The running app's hold on its userData folder. */
export interface ServerLock {
  /** Records the port, once the server listens, so a second start can name its address. False when another start holds the
   *  store now: the server must stop. */
  setPort(port: number): boolean;
  /** Gives the folder up. Only removes the lock file while it is still this process's. */
  release(): void;
}

const isCode = (e: unknown, code: string): boolean => e instanceof Error && "code" in e && e.code === code;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return isCode(e, "EPERM");
  }
}

/** This start of the computer's ID (macOS kern.bootsessionuuid, Linux boot_id), or null where there is none to read.
 *  A clock step can't change it, unlike a time worked out from the uptime (Security R2). */
function bootId(): string | null {
  try {
    if (process.platform === "darwin") {
      const r = spawnSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8", timeout: 2000 });
      return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    }
    if (process.platform === "linux") return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || null;
  } catch {
    // No ID: only the pid counts.
  }
  return null;
}

function parseLock(text: string): Lock | null {
  try {
    const r = LockSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (isCode(e, "ENOENT")) return null;
    throw e;
  }
}

function readLock(path: string): Lock | null {
  const text = readText(path);
  return text === null ? null : parseLock(text);
}

const starting = (): tm.TmError => new tm.TmError("usage", "Another Time Machine is starting for this store. Try again in a moment.");

/**
 * Takes `server.lock` (pid, port, boot ID) in the app's userData folder, so one store has one running app.
 * A lock left by a process that has ended, or by an earlier start of the computer, is taken over. While another live
 * process holds it, this throws a usage error (exit 64 from tm ui) that names the running app's address.
 */
export function acquireServerLock(dir: string): ServerLock {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "server.lock");
  const gate = `${path}.takeover`;
  const boot = bootId();
  const body: Lock = { pid: process.pid, port: null, ...(boot ? { boot } : {}), nonce: randomUUID() };
  // A pid in use again counts only if it was written in this start of the computer (F13). A lock with no boot ID (written
  // before boot IDs, or where none could be read) is dated by its file instead, with a margin for a clock step (R2).
  const sinceBoot = (file: string): boolean => {
    try {
      return statSync(file).mtimeMs >= Date.now() - uptime() * 1000 - 600_000;
    } catch {
      return true;
    }
  };
  const live = (l: Lock, file: string): boolean =>
    l.pid === process.pid || (alive(l.pid) && (boot && l.boot ? l.boot === boot : sinceBoot(file)));
  const mine = `${path}.${process.pid}.${randomUUID()}.new`;
  // Holds this start's nonce, so a gate or lock that reads exactly this text is this start's own.
  const myText = JSON.stringify(body) + "\n";
  writeFileSync(mine, myText);
  try {
    for (let attempt = 0; ; attempt++) {
      // A link appears whole and only where no lock is, so no start reads a half-written lock or replaces another's.
      try {
        linkSync(mine, path);
        break;
      } catch (e) {
        if (!isCode(e, "EEXIST")) throw e;
      }
      const seen = readText(path);
      if (seen === null) continue; // given up meanwhile: link again
      const held = parseLock(seen);
      if (held && live(held, path)) {
        const where = held.port === null ? "" : ` at http://127.0.0.1:${held.port}`;
        throw new tm.TmError("usage", `Time Machine is already running for this store${where}. Open that, or stop it first. If it isn't running, delete ${path}.`);
      }
      if (attempt >= 3) throw starting();
      // Left by an app that ended, or unreadable. One start at a time takes a lock over, through the gate file, and removes it
      // only if it is still the lock it read: a start that stalled after reading it can't remove the lock a start took since,
      // and two apps never run on one store (F2, R1).
      try {
        linkSync(mine, gate);
      } catch (e) {
        if (!isCode(e, "EEXIST")) throw e;
        // Gone already: another start just finished. Only a gate that reads, and whose start ended, is removed (R1).
        const text = readText(gate);
        if (text === null) continue;
        const g = parseLock(text);
        if (g && live(g, gate)) throw starting();
        // Left by a start that ended mid-takeover. Moved aside, then checked to be the gate that was read: a live start's
        // fresh gate moved by mistake goes back, unless another has been linked since (Security LOW 6).
        const aside = `${gate}.${process.pid}.${randomUUID()}.old`;
        try {
          renameSync(gate, aside);
        } catch (err) {
          if (isCode(err, "ENOENT")) continue;
          throw err;
        }
        if (readText(aside) !== text) {
          try {
            linkSync(aside, gate);
          } catch (err) {
            if (!isCode(err, "EEXIST")) throw err;
          }
        }
        rmSync(aside, { force: true });
        continue;
      }
      // Holding the gate: the stale lock goes, and this start's lock is linked in, each only while the gate still holds this
      // start's nonce. Another start may have moved the gate aside meanwhile, taking it for a stale one (Security N2).
      const holding = (): boolean => readText(gate) === myText;
      let took = false;
      try {
        if (holding() && readText(path) === seen) {
          rmSync(path, { force: true });
          if (holding()) {
            try {
              linkSync(mine, path);
              took = true;
            } catch (e) {
              if (!isCode(e, "EEXIST")) throw e;
            }
          }
        }
      } finally {
        if (holding()) rmSync(gate, { force: true });
      }
      if (took) break;
    }
  } finally {
    rmSync(mine, { force: true });
  }
  const ours = (): boolean => readLock(path)?.pid === process.pid;
  return {
    // Only into this process's own lock; the caller stops on false (F2).
    setPort: (port) => {
      if (!ours()) return false;
      writeJson(path, { ...body, port });
      return true;
    },
    release: () => {
      if (ours()) rmSync(path, { force: true });
    },
  };
}
