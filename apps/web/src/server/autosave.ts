// Auto save while the app is open: for each project with autoSave "change", a change in its folder
// makes a save point once the folder has been quiet for a while. Watching reads no file contents
// and writes nothing in the folder. Where a recursive watch is not available, it polls instead,
// and the save itself skips when nothing changed.
import { watch as fsWatch } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

/** A running watch. */
export interface Watch {
  close(): void;
}

/** What a watcher reports: a path relative to the project root, or null when the system did not say which. */
export type WatchFn = (root: string, onChange: (rel: string | null) => void, onError: () => void) => Watch;

export interface AutoSaveProject {
  id: string;
  path: string;
  autoSave: "off" | "change";
}

export interface AutoSaveDeps {
  /** Makes one save point if anything changed. Errors are the caller's to report; auto save carries on. */
  save: (projectId: string) => Promise<unknown>;
  /** True while a check, search, rewind or save runs on the project. Auto save waits until it ends. */
  busy: (projectId: string) => boolean;
  /** Folders whose changes never count, such as the Time Machine store. */
  ignoreDirs?: string[];
  quietMs?: number;
  minGapMs?: number;
  pollMs?: number;
  /** Tests pass their own. The default is fs.watch with recursive on, and throws where that is unavailable. */
  watch?: WatchFn;
}

const IGNORED_DIRS = new Set([".git", "node_modules"]);

/** Paths whose changes never cause a save: Git and installed dependencies, and editor or Finder temp files. */
export function ignoredPath(rel: string): boolean {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  const name = parts.at(-1) ?? "";
  return name === ".DS_Store" || name.startsWith("~$") || name.startsWith(".#") || name.endsWith(".swp");
}

const nodeWatch: WatchFn = (root, onChange, onError) => {
  // Not persistent: an open watch never keeps the app running after it closes.
  const w = fsWatch(root, { recursive: true, persistent: false }, (_event, filename) => onChange(filename === null ? null : String(filename)));
  w.on("error", onError);
  return w;
};

interface Running {
  path: string;
  stop: () => void;
  timer: NodeJS.Timeout | undefined;
  lastSave: number;
}

export class AutoSaver {
  private readonly running = new Map<string, Running>();
  private readonly quietMs: number;
  private readonly minGapMs: number;
  private readonly pollMs: number;
  private readonly watch: WatchFn;

  constructor(private readonly deps: AutoSaveDeps) {
    this.quietMs = deps.quietMs ?? 20_000;
    this.minGapMs = deps.minGapMs ?? 60_000;
    this.pollMs = deps.pollMs ?? 60_000;
    this.watch = deps.watch ?? nodeWatch;
  }

  /** Starts watching the projects with autoSave "change" and stops the rest, including removed ones. */
  sync(projects: readonly AutoSaveProject[]): void {
    const wanted = new Map(projects.filter((p) => p.autoSave === "change").map((p) => [p.id, p.path]));
    for (const [id, r] of this.running) if (wanted.get(id) !== r.path) this.stop(id);
    for (const [id, path] of wanted) if (!this.running.has(id)) this.start(id, path);
  }

  /** Ids of the projects being watched or polled. */
  watching(): string[] {
    return [...this.running.keys()];
  }

  close(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  private start(id: string, path: string): void {
    const r: Running = { path, stop: () => undefined, timer: undefined, lastSave: Number.NEGATIVE_INFINITY };
    this.running.set(id, r);
    const poll = (): void => {
      const t = setInterval(() => this.fire(id), this.pollMs);
      t.unref();
      r.stop = () => clearInterval(t);
    };
    try {
      const w = this.watch(path, (rel) => this.changed(id, rel), () => {
        // The watch broke (the folder moved, or too many files): poll instead.
        w.close();
        if (this.running.get(id) === r) poll();
      });
      r.stop = () => w.close();
    } catch {
      // No recursive watch on this system: poll. A save with nothing changed is skipped.
      poll();
    }
  }

  private stop(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    r.stop();
    clearTimeout(r.timer);
    this.running.delete(id);
  }

  private changed(id: string, rel: string | null): void {
    const r = this.running.get(id);
    if (!r) return;
    if (rel !== null) {
      if (ignoredPath(rel)) return;
      const abs = isAbsolute(rel) ? rel : join(r.path, rel);
      const within = (dir: string): boolean => {
        const d = relative(dir, abs);
        return d === "" || (!d.startsWith("..") && !isAbsolute(d));
      };
      if (this.deps.ignoreDirs?.some(within)) return;
    }
    this.schedule(r, id, this.quietMs);
  }

  private schedule(r: Running, id: string, ms: number): void {
    clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      r.timer = undefined;
      this.fire(id);
    }, ms);
    r.timer.unref();
  }

  /** Saves now, unless the project is busy or saved less than minGapMs ago: then it tries again later. */
  private fire(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    const wait = r.lastSave + this.minGapMs - Date.now();
    if (wait > 0) return this.schedule(r, id, wait);
    if (this.deps.busy(id)) return this.schedule(r, id, this.quietMs);
    r.lastSave = Date.now();
    this.deps.save(id).catch(() => undefined);
  }
}
