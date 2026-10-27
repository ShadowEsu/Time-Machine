import { spawn, spawnSync } from "node:child_process";
import { onInterrupt } from "./cleanup.js";

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
  /** True when the caller's signal stopped the command. */
  stopped: boolean;
  output: string;
  spawnError: string | null;
}

const MAX_OUTPUT = 1024 * 1024;

/**
 * Runs a command in its own process group. Resolves when the command exits, then kills
 * anything it left running in the background, so a stray child cannot hold the check open.
 * Aborting `signal` kills the whole group, the same way a timeout does.
 * `onOutput` sees the output collected so far after each chunk, so a caller can show a check while it runs.
 */
export function runWithTimeout(
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal; onOutput?: (output: string) => void },
): Promise<TimedResult> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let stopped = false;
    let settled = false;
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const killGroup = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const dispose = onInterrupt(killGroup);
    const collect = (chunk: Buffer): void => {
      if (output.length >= MAX_OUTPUT) return;
      output += chunk.toString("utf8");
      opts.onOutput?.(output);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, Math.max(1, opts.timeoutMs));
    // Once the command has exited, its exit code is the result: a late Stop or timeout must not replace it.
    let exited = false;
    const stop = (): void => {
      if (exited) return;
      stopped = true;
      killGroup();
    };
    opts.signal?.addEventListener("abort", stop, { once: true });
    if (opts.signal?.aborted) stop();
    const settle = (r: Omit<TimedResult, "timedOut" | "stopped" | "output">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", stop);
      dispose();
      resolve({ ...r, timedOut, stopped, output: output.slice(0, MAX_OUTPUT) });
    };
    child.on("error", (e) => settle({ code: 127, signal: null, spawnError: e.message }));
    child.on("exit", (code, signal) => {
      exited = true;
      clearTimeout(timer);
      killGroup();
      // Give the pipes a moment to drain, then stop waiting on anything that escaped the group.
      const grace = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle({ code, signal, spawnError: null });
      }, 250);
      child.on("close", () => {
        clearTimeout(grace);
        settle({ code, signal, spawnError: null });
      });
    });
  });
}
