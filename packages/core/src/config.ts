import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { TmError } from "./errors.js";
import { isSafeRelPath } from "./paths.js";

export const CONFIG_FILE = "timemachine.yml";

export const LOCKFILES = [
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
  "requirements.txt", "poetry.lock", "uv.lock", "Pipfile.lock",
  "Cargo.lock", "go.sum", "Gemfile.lock", "composer.lock",
];

export const ENV_FILES = [
  "Dockerfile", "docker-compose.yml", "compose.yaml", ".nvmrc", ".node-version",
  ".tool-versions", ".python-version", ".devcontainer/devcontainer.json",
];

const VerifySchema = z.strictObject({
  command: z.string().default(""),
  setup: z.string().default(""),
  timeoutSeconds: z.number().int().positive().max(86_400).default(600),
  network: z.enum(["allow", "deny"]).default("allow"),
});

const CaptureSchema = z.strictObject({
  untracked: z.boolean().default(true),
  include: z.array(z.string()).default([]),
  maxFileMB: z.number().positive().max(1024).default(5),
});

const ConfigFilesSchema = z.strictObject({
  files: z.array(z.string().refine(isSafeRelPath, "must be a path inside the project")).default([".env"]),
  plain: z.array(z.string()).default([]),
});

const EnvironmentSchema = z.strictObject({
  files: z.array(z.string()).default(ENV_FILES),
});

export const ProjectConfigSchema = z.strictObject({
  version: z.literal(1).default(1),
  verify: VerifySchema.prefault({}),
  capture: CaptureSchema.prefault({}),
  config: ConfigFilesSchema.prefault({}),
  environment: EnvironmentSchema.prefault({}),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export function loadConfig(root: string): { config: ProjectConfig; exists: boolean } {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { config: ProjectConfigSchema.parse({}), exists: false };
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8")) ?? {};
  } catch (e) {
    throw new TmError("usage", `${CONFIG_FILE} is not valid YAML: ${(e as Error).message}`);
  }
  const r = ProjectConfigSchema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "(top)"}: ${i.message}`).join("; ");
    throw new TmError("usage", `${CONFIG_FILE} has a problem. ${msg}`);
  }
  return { config: r.data, exists: true };
}
