import { spawn, spawnSync } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runSync(file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): RunResult {
  const r = spawnSync(file, args, { cwd: opts.cwd, env: opts.env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { code: 127, stdout: "", stderr: r.error.message };
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

export interface TimedResult {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  output: string;
  spawnError: string | null;
}

const MAX_OUTPUT = 1024 * 1024;

/** Runs a command in its own process group and kills the whole group on timeout. */
export function runWithTimeout(
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<TimedResult> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let spawnError: string | null = null;
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (chunk: Buffer): void => {
      if (output.length < MAX_OUTPUT) output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, opts.timeoutMs);
    child.on("error", (e) => {
      spawnError = e.message;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: spawnError ? 127 : code, signal, timedOut, output: output.slice(0, MAX_OUTPUT), spawnError });
    });
  });
}
