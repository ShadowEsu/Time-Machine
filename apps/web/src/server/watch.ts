// Watches each project's store for new verdicts and audit entries. When something changes,
// the app re-reads the store through the engine. It never parses the files itself.
import { existsSync, watch, type FSWatcher } from "node:fs";
import * as tm from "@timetm/core";
import type { ProjectEntry } from "../shared/api.js";
import type { AppState } from "./state.js";

const WATCHED = new Set(["verdicts.jsonl", "audit.jsonl"]);

export class StoreWatcher {
  /** One watch per project, with the folder it was made for: a project moved to a new folder has a new store. */
  private readonly watchers = new Map<string, { w: FSWatcher; path: string }>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly poll: NodeJS.Timeout;

  constructor(
    private readonly state: AppState,
    private readonly onChange: (p: ProjectEntry) => void,
  ) {
    this.sync();
    // A new project has no store until its first save point. Look again now and then.
    this.poll = setInterval(() => this.sync(), 4000);
  }

  sync(): void {
    const paths = new Map(this.state.projects.map((p) => [p.id, p.path]));
    for (const [id, x] of this.watchers) {
      if (paths.get(id) !== x.path) {
        x.w.close();
        this.watchers.delete(id);
      }
    }
    for (const p of this.state.projects) {
      if (this.watchers.has(p.id) || !existsSync(p.path)) continue;
      let dir: string;
      try {
        dir = tm.storeDirFor({ cwd: p.path, env: process.env });
      } catch {
        continue;
      }
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, (_event, file) => {
          if (file && !WATCHED.has(file.toString())) return;
          this.bump(p.id);
        });
        w.on("error", () => {
          w.close();
          this.watchers.delete(p.id);
        });
        this.watchers.set(p.id, { w, path: p.path });
      } catch {
        // Try again on the next poll.
      }
    }
  }

  private bump(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        const p = this.state.find(id);
        if (p) this.onChange(p);
      }, 250),
    );
  }

  close(): void {
    clearInterval(this.poll);
    for (const x of this.watchers.values()) x.w.close();
    for (const t of this.timers.values()) clearTimeout(t);
  }
}
