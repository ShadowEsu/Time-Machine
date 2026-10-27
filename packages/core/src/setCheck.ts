import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, type Document } from "yaml";
import { z } from "zod";
import { audit } from "./audit.js";
import { CONFIG_FILE, loadConfig, ProjectConfigSchema, type ProjectConfig } from "./config.js";
import { recordConsent } from "./consent.js";
import { TmError } from "./errors.js";
import { configRoot, resolveProject, type Project } from "./project.js";
import type { Ctx, ProjectSettings, SetCheckResult } from "./types.js";

/**
 * Edits the project's timemachine.yml in place, keeping comments, and returns the new settings. A plain
 * folder keeps its file in the store, made here when it has none yet. Never writes through a link.
 */
function editConfig(p: Project, edit: (doc: Document) => void, opts: { mustExist?: boolean } = {}): { path: string; config: ProjectConfig; read: string; written: string } {
  const path = join(configRoot(p), CONFIG_FILE);
  if (p.kind === "folder" && !opts.mustExist && !existsSync(path)) writeFileSync(path, "# Time Machine settings for this folder. They live in the store, never in the folder.\nversion: 1\n", { flag: "wx" });
  if (!existsSync(path)) {
    const why = p.kind === "folder"
      ? "This folder has no check settings saved yet, so nothing was changed."
      : opts.mustExist ? `${CONFIG_FILE} is no longer there, so nothing was changed.` : `There is no ${CONFIG_FILE} yet. Run tm init first.`;
    throw new TmError("usage", why);
  }
  // Never write through a link: it could point at a file outside the project. A hard link shares its contents with another path.
  const st = lstatSync(path);
  if (!st.isFile()) throw new TmError("usage", `${CONFIG_FILE} is a symbolic link or not a regular file, so it was left alone.`);
  if (st.nlink > 1) throw new TmError("usage", `${CONFIG_FILE} is a hard link shared with another file, so it was left alone.`);
  const bytes = readFileSync(path);
  const doc = parseDocument(bytes.toString("utf8"));
  if (doc.errors.length) throw new TmError("usage", `${CONFIG_FILE} is not valid YAML: ${doc.errors[0]?.message ?? ""}`);
  edit(doc);
  const r = ProjectConfigSchema.safeParse(doc.toJS());
  if (!r.success) throw new TmError("usage", `${CONFIG_FILE} has a problem, so it was left alone.`);
  const text = doc.toString();
  writeFileSync(path, text);
  const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
  return { path, config: r.data, read: sha(bytes), written: sha(text) };
}

const OneLine = z.string().trim().refine((s) => !/[\r\n\0]/.test(s), "The check and the install step must be one line each.");

/**
 * Changes the check (verify.command) in timemachine.yml and keeps the rest of the file,
 * comments included. The user chose this check, so it is approved on this computer too.
 * The audit log records that it changed, never the command itself. A plain folder keeps its
 * timemachine.yml in the store, made here when it has none yet.
 */
export async function setCheck(ctx: Ctx, command: string): Promise<SetCheckResult> {
  const p = resolveProject(ctx);
  const cmd = command.trim();
  if (!cmd) throw new TmError("usage", "The check cannot be empty. For example: npm test.");
  if (/[\r\n\0]/.test(cmd)) throw new TmError("usage", "The check must be one line.");
  const { path, config, read, written } = editConfig(p, (doc) => doc.setIn(["verify", "command"], cmd));
  recordConsent(p, config);
  audit(p, "set-check", null, "changed the check");
  return { configPath: path, verifyCommand: config.verify.command, read, written };
}

function settings(config: ProjectConfig, configPath: string): ProjectSettings {
  const { command, setup, timeoutSeconds, network } = config.verify;
  return { command, setup, timeoutSeconds, network, maxFileMB: config.capture.maxFileMB, configPath };
}

/** The project's check and capture settings, from its timemachine.yml, or the defaults when it has none. */
export function projectConfig(ctx: Ctx): ProjectSettings {
  const p = resolveProject(ctx);
  return settings(loadConfig(configRoot(p)).config, join(configRoot(p), CONFIG_FILE));
}

const SettingsPatch = z.strictObject({
  command: OneLine.optional(),
  setup: OneLine.optional(),
  timeoutSeconds: z.number().int("The time limit must be whole seconds.").min(1, "The time limit must be at least 1 second.").max(86_400, "The time limit can be at most 86400 seconds (a day).").optional(),
  network: z.enum(["allow", "deny"]).optional(),
  maxFileMB: z.number().positive("The file size limit must be more than 0 MB.").max(1024, "The file size limit can be at most 1024 MB.").optional(),
});

/** The command was not the expected one when the change was about to be made (setProjectConfig's ifCommand), so nothing was written. */
export const CHECK_CHANGED_MEANWHILE = "The check in timemachine.yml changed meanwhile, so it was left as it is.";

/**
 * Changes some of the project's settings in timemachine.yml, keeping the rest of the file and its comments.
 * A changed check (command, install step or network rule) is the user's choice, so it is approved on this
 * computer too. The audit log names which settings changed, never their values. With `ifCommand` the change is
 * made only while the file exists and its check command is exactly that, checked on the text about to be edited
 * (compare and set); otherwise nothing is written and a usage error says so. `written` is the hash of the text written.
 */
export function setProjectConfig(ctx: Ctx, patch: Partial<Omit<ProjectSettings, "configPath" | "read" | "written">>, opts: { ifCommand?: string } = {}): ProjectSettings {
  const parsed = SettingsPatch.safeParse(patch);
  if (!parsed.success) throw new TmError("usage", parsed.error.issues[0]?.message ?? "Those settings are not valid.");
  const p = resolveProject(ctx);
  const at: Record<keyof z.infer<typeof SettingsPatch>, string[]> = {
    command: ["verify", "command"],
    setup: ["verify", "setup"],
    timeoutSeconds: ["verify", "timeoutSeconds"],
    network: ["verify", "network"],
    maxFileMB: ["capture", "maxFileMB"],
  };
  const changed = (["command", "setup", "timeoutSeconds", "network", "maxFileMB"] as const).filter((k) => parsed.data[k] !== undefined);
  if (!changed.length) return projectConfig(ctx);
  const guarded = opts.ifCommand !== undefined;
  const { path, config, read, written } = editConfig(p, (doc) => {
    if (guarded && String(doc.getIn(["verify", "command"]) ?? "") !== opts.ifCommand) throw new TmError("usage", CHECK_CHANGED_MEANWHILE);
    for (const k of changed) doc.setIn(at[k], parsed.data[k]);
  }, { mustExist: guarded });
  if (changed.some((k) => k === "command" || k === "setup" || k === "network") && config.verify.command.trim()) recordConsent(p, config);
  audit(p, "set-config", null, `changed ${changed.join(", ")}`);
  return { ...settings(config, path), read, written };
}
