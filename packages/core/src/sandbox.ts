import { existsSync } from "node:fs";
import { runSync } from "./exec.js";

export interface Sandbox {
  name: string;
  wrap: (command: string) => [string, string[]];
}

const MAC_PROFILE = "(version 1)(allow default)(deny network*)";

function works(file: string, args: string[], env: NodeJS.ProcessEnv): boolean {
  return runSync(file, args, { cwd: "/", env }).code === 0;
}

/**
 * Finds a way to run a command with no network. Returns null when none works.
 * TM_SANDBOX=none forces null, which can only make verify stricter (BLOCKED).
 */
export function detectSandbox(env: NodeJS.ProcessEnv): Sandbox | null {
  if (env.TM_SANDBOX === "none") return null;
  if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
    return { name: "sandbox-exec", wrap: (c) => ["/usr/bin/sandbox-exec", ["-p", MAC_PROFILE, "/bin/sh", "-c", c]] };
  }
  if (process.platform === "linux") {
    if (works("bwrap", ["--dev-bind", "/", "/", "--unshare-net", "true"], env)) {
      return { name: "bwrap", wrap: (c) => ["bwrap", ["--dev-bind", "/", "/", "--unshare-net", "/bin/sh", "-c", c]] };
    }
    if (works("unshare", ["--map-current-user", "-n", "true"], env)) {
      return { name: "unshare", wrap: (c) => ["unshare", ["--map-current-user", "-n", "/bin/sh", "-c", c]] };
    }
    if (works("unshare", ["-rn", "true"], env)) {
      return { name: "unshare", wrap: (c) => ["unshare", ["-rn", "/bin/sh", "-c", c]] };
    }
  }
  return null;
}
