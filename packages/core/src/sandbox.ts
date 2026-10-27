import { existsSync, realpathSync } from "node:fs";
import { runSync } from "./exec.js";

export interface Sandbox {
  name: string;
  /** True when the command can't write outside the copy and the system temp folders (macOS sandbox-exec). Reads stay allowed. */
  confinesWrites: boolean;
  /** The command line that runs `command` with no network. `copy` is the folder the check runs in, the one place it may write besides temp folders. */
  wrap: (command: string, copy: string) => [string, string[]];
}

/**
 * No network, and no writes outside the copy, the system temp folders and /dev. Reads are allowed. The
 * copy is given by its real path: macOS resolves /var and /tmp to /private before it checks a rule.
 */
function macProfile(copy: string): string {
  let real = copy;
  try {
    real = realpathSync.native(copy);
  } catch {
    // Not made yet; the temp folders rule still covers a copy in the system temp folder.
  }
  // A profile string escapes quotes and backslashes.
  const writable = [real, "/private/tmp", "/private/var/folders", "/dev"].map((d) => `(subpath "${d.replace(/[\\"]/g, (c) => `\\${c}`)}")`).join(" ");
  return `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* ${writable})`;
}

function works(file: string, args: string[], env: NodeJS.ProcessEnv): boolean {
  return runSync(file, args, { cwd: "/", env }).code === 0;
}

/**
 * Finds a way to run a command with no network. Returns null when none works.
 * TM_SANDBOX=none forces null, which can only make verify stricter (BLOCKED).
 */
export function detectSandbox(env: NodeJS.ProcessEnv): Sandbox | null {
  if (env.TM_SANDBOX === "none") return null;
  if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && works("/usr/bin/sandbox-exec", ["-p", macProfile("/private/tmp"), "/usr/bin/true"], env)) {
    return { name: "sandbox-exec", confinesWrites: true, wrap: (c, copy) => ["/usr/bin/sandbox-exec", ["-p", macProfile(copy), "/bin/sh", "-c", c]] };
  }
  if (process.platform === "linux") {
    if (works("bwrap", ["--dev-bind", "/", "/", "--unshare-net", "true"], env)) {
      return { name: "bwrap", confinesWrites: false, wrap: (c) => ["bwrap", ["--dev-bind", "/", "/", "--unshare-net", "/bin/sh", "-c", c]] };
    }
    if (works("unshare", ["--map-current-user", "-n", "true"], env)) {
      return { name: "unshare", confinesWrites: false, wrap: (c) => ["unshare", ["--map-current-user", "-n", "/bin/sh", "-c", c]] };
    }
    if (works("unshare", ["-rn", "true"], env)) {
      return { name: "unshare", confinesWrites: false, wrap: (c) => ["unshare", ["-rn", "/bin/sh", "-c", c]] };
    }
  }
  return null;
}
