import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./audit.js";
import { CONFIG_FILE, loadConfig, type ProjectConfig } from "./config.js";
import { checkCommand, consentState, recordConsent } from "./consent.js";
import { configRoot, resolveProject } from "./project.js";
import { detectSandbox } from "./sandbox.js";
import type { Ctx, InitResult } from "./types.js";

const NPM_DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';

/** Guesses the check from the project. Returns "" when there is nothing safe to guess. */
export function guessCommand(root: string): string {
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const scripts = (JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, unknown> }).scripts ?? {};
      if (typeof scripts.test === "string" && scripts.test !== NPM_DEFAULT_TEST) return "npm test";
      if (typeof scripts.build === "string") return "npm run build";
    } catch {
      // A broken package.json is the user's to fix. Leave the check empty.
    }
  }
  if (existsSync(join(root, "Cargo.toml"))) return "cargo test";
  if (existsSync(join(root, "go.mod"))) return "go test ./...";
  if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "pytest.ini"))) return "pytest";
  return "";
}

const NPM_FLAGS = "--prefer-offline --no-audit --no-fund";

/**
 * Guesses the install step. Checks run in a fresh copy with no node_modules, so a Node project
 * with dependencies needs one, or every check fails to start. Returns "" when nothing needs installing.
 */
export function guessSetup(root: string): string {
  const pkg = join(root, "package.json");
  if (!existsSync(pkg)) return "";
  try {
    const json = JSON.parse(readFileSync(pkg, "utf8")) as Record<string, unknown>;
    const has = (k: string): boolean => typeof json[k] === "object" && json[k] !== null && Object.keys(json[k] as object).length > 0;
    if (!has("dependencies") && !has("devDependencies") && !has("optionalDependencies")) return "";
  } catch {
    return "";
  }
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm install --frozen-lockfile --prefer-offline";
  if (existsSync(join(root, "yarn.lock"))) return "yarn install --frozen-lockfile --prefer-offline";
  if (existsSync(join(root, "package-lock.json")) || existsSync(join(root, "npm-shrinkwrap.json"))) return `npm ci ${NPM_FLAGS}`;
  return `npm install ${NPM_FLAGS}`;
}

/**
 * Writes timemachine.yml, or keeps an existing one untouched, and approves its current check on
 * this computer. Running it again after the check changed is how the user approves the new one.
 * With approve: false it only writes or keeps the file; approvedCheck then reports an approval that
 * already matches, or null. An empty verify.command runs nothing, so it is never approved: approvedCheck is null.
 * A plain folder outside any repository becomes a folder project. Its settings go in the store, never
 * in the folder, and it starts with no check: a check is optional for a folder.
 */
export async function init(ctx: Ctx, opts: { approve?: boolean } = {}): Promise<InitResult> {
  const p = resolveProject(ctx, { create: "write" });
  const dir = configRoot(p);
  const path = join(dir, CONFIG_FILE);
  const sandbox = detectSandbox(p.env);
  const noCheck = (config: ProjectConfig): boolean => !config.verify.command.trim();
  const approve = (config: ProjectConfig): string | null => {
    if (noCheck(config)) return null;
    if (opts.approve !== false) return recordConsent(p, config);
    return consentState(p, config) === "approved" ? checkCommand(config) : null;
  };
  const approval = (config: ProjectConfig): string => (noCheck(config) ? "no check to approve" : opts.approve === false ? "did not approve the check" : "approved the check");
  if (existsSync(path)) {
    const { config } = loadConfig(dir);
    const approvedCheck = approve(config);
    audit(p, "init", null, `kept existing settings, ${approval(config)}`);
    return { configPath: path, created: false, verifyCommand: config.verify.command, verifySetup: config.verify.setup, network: config.verify.network, sandbox: sandbox?.name ?? null, approvedCheck };
  }
  const folder = p.kind === "folder";
  const command = folder ? "" : guessCommand(p.root);
  const setup = folder ? "" : guessSetup(p.root);
  const network = sandbox ? "deny" : "allow";
  const yaml = `# Time Machine settings for this project.
version: 1

verify:
  # Runs first in the fresh copy, with the network on, to install dependencies.
  setup: ${JSON.stringify(setup)}
  # The check that decides if a save point works. Exit code 0 means it works.
  command: ${JSON.stringify(command)}
  timeoutSeconds: 600
  # deny turns the network off during checks. It needs a sandbox.
  network: ${network}${sandbox ? `   # enforced with ${sandbox.name}` : "   # no sandbox found, so checks keep the network on"}

capture:
  # Files that are not in Git yet are saved too, unless .gitignore skips them.
  untracked: true
  include: []
  maxFileMB: 5

config:
  # Only key names and a fingerprint are saved. Values are saved only for
  # keys listed under plain, and never if they look like a secret.
  files: [".env"]
  plain: []
`;
  writeFileSync(path, yaml, { flag: "wx" });
  const { config } = loadConfig(dir);
  const approvedCheck = approve(config);
  audit(p, "init", null, `created settings, ${approval(config)}`);
  return { configPath: path, created: true, verifyCommand: command, verifySetup: setup, network, sandbox: sandbox?.name ?? null, approvedCheck };
}
