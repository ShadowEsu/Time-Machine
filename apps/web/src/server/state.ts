// Projects and settings the app remembers, kept as JSON in the app's userData folder.
// Both files are validated with Zod on every read. A broken file is set aside, not trusted.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

export class AppState {
  private readonly projectsPath: string;
  private readonly settingsPath: string;
  projects: ProjectEntry[];
  settings: Settings;
  /** The project the user looked at last. The tray and hotkey act on it. */
  activeId: string | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.projectsPath = join(dir, "projects.json");
    this.settingsPath = join(dir, "settings.json");
    this.projects = readJson(this.projectsPath, ProjectsFileSchema, { version: 1 as const, projects: [] }).projects;
    this.settings = readJson(this.settingsPath, SettingsSchema, SettingsSchema.parse({}));
    this.activeId = this.projects[0]?.id ?? null;
  }

  saveProjects(): void {
    writeJson(this.projectsPath, { version: 1, projects: this.projects });
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    this.settings = SettingsSchema.parse({ ...this.settings, ...defined });
    writeJson(this.settingsPath, this.settings);
    return this.settings;
  }

  find(id: string): ProjectEntry | null {
    return this.projects.find((p) => p.id === id) ?? null;
  }

  active(): ProjectEntry | null {
    return (this.activeId ? this.find(this.activeId) : null) ?? this.projects[0] ?? null;
  }
}
