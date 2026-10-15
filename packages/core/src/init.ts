import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./audit.js";
import { CONFIG_FILE, loadConfig } from "./config.js";
import { resolveProject } from "./project.js";
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

export async function init(ctx: Ctx): Promise<InitResult> {
  const p = resolveProject(ctx);
  const path = join(p.root, CONFIG_FILE);
  const sandbox = detectSandbox(p.env);
  if (existsSync(path)) {
    const { config } = loadConfig(p.root);
    audit(p, "init", null, "kept existing settings");
    return { configPath: path, created: false, verifyCommand: config.verify.command, network: config.verify.network, sandbox: sandbox?.name ?? null };
  }
  const command = guessCommand(p.root);
  const network = sandbox ? "deny" : "allow";
  const yaml = `# Time Machine settings for this project.
version: 1

verify:
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
  audit(p, "init", null, "created settings");
  return { configPath: path, created: true, verifyCommand: command, network, sandbox: sandbox?.name ?? null };
}
