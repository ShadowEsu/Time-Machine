// Watches each project's store for new verdicts and audit entries. When something changes,
// the app re-reads the store through the engine. It never parses the files itself.
import { existsSync, watch, type FSWatcher } from "node:fs";
import * as tm from "@timetm/core";
import type { ProjectEntry } from "../shared/api.js";
import type { AppState } from "./state.js";

const WATCHED = new Set(["verdicts.jsonl", "audit.jsonl"]);

export class StoreWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
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
    const ids = new Set(this.state.projects.map((p) => p.id));
    for (const [id, w] of this.watchers) {
      if (!ids.has(id)) {
        w.close();
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
        this.watchers.set(p.id, w);
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
    for (const w of this.watchers.values()) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
  }
}
