import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "./audit.js";
import { onInterrupt } from "./cleanup.js";
import { loadConfig, type ProjectConfig } from "./config.js";
import { TmError } from "./errors.js";
import { runWithTimeout, type TimedResult } from "./exec.js";
import { materialize, removeWorktree } from "./materialize.js";
import { resolveProject, type Project } from "./project.js";
import { detectSandbox } from "./sandbox.js";
import { looksSecret, parseDotenv, redact } from "./secrets.js";
import type { Manifest } from "./manifest.js";
import { ensureStore, listIds, readManifest, stamp } from "./store.js";
import type { Ctx, VerifyResult } from "./types.js";
import type { Verdict } from "./verdict.js";
import { recordVerdict } from "./verdicts.js";

const KEEP_ENV = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR", "SHELL", "SystemRoot"];
/** Network and package manager settings. Without them, installs fail behind proxies and custom certificates. */
const KEEP_ENV_PATTERN = /^(https?_proxy|no_proxy|all_proxy|node_extra_ca_certs|ssl_cert_file|ssl_cert_dir|requests_ca_bundle|npm_config_.+|yarn_.+|pnpm_.+|pip_.+|uv_.+|cargo_.+|goproxy|goflags|corepack_.+)$/i;

function cleanEnv(base: NodeJS.ProcessEnv, plain: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && (KEEP_ENV.includes(k) || KEEP_ENV_PATTERN.test(k))) env[k] = v;
  return { ...env, ...plain, CI: "1", NO_COLOR: "1", TM_VERIFY: "1" };
}

/** Secret values in the given folders, used only to scrub logs and screen prompts. Never stored. */
export function secretValues(roots: string[], cfg: ProjectConfig): string[] {
  const out: string[] = [];
  for (const file of roots.flatMap((r) => cfg.config.files.map((f) => join(r, f)))) {
    const full = file;
    if (!existsSync(full)) continue;
    for (const { name, value } of parseDotenv(readFileSync(full, "utf8"))) {
      if (!cfg.config.plain.includes(name) || looksSecret(value)) out.push(value);
    }
  }
  return out;
}

export function latestId(p: Project): string {
  const last = listIds(p).at(-1);
  if (!last) throw new TmError("not_found", "There are no checkpoints yet. Run tm checkpoint first.");
  return last;
}

function judge(r: TimedResult, timeoutSeconds: number): { verdict: Verdict; reason: string } {
  if (r.timedOut) return { verdict: "ERROR", reason: `The check timed out after ${timeoutSeconds} s and was stopped.` };
  if (r.spawnError || r.code === 126 || r.code === 127) return { verdict: "ERROR", reason: `The check command could not run (exit ${r.code ?? "none"}). Is it installed?` };
  if (r.code === null) return { verdict: "ERROR", reason: `The check was stopped by ${r.signal ?? "a signal"}.` };
  if (r.code === 0) return { verdict: "PASS", reason: "The check passed." };
  return { verdict: "FAIL", reason: `The check failed with exit code ${r.code}.` };
}

/** Options for a check. Aborting `signal` stops it: nothing is recorded, and the save point keeps the verdict it had. */
export interface VerifyOptions {
  signal?: AbortSignal;
}

export async function verify(ctx: Ctx, id?: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const p = resolveProject(ctx);
  const { config: cfg } = loadConfig(p.root);
  ensureStore(p);
  const target = id ?? latestId(p);
  const started = Date.now();
  const policy = cfg.verify.network;
  const sandbox = policy === "deny" ? detectSandbox(p.env) : null;
  const command = cfg.verify.setup ? `${cfg.verify.setup} && ${cfg.verify.command}` : cfg.verify.command;

  const finish = (verdict: Verdict, reason: string, exitCode: number | null = null, log: string | null = null): VerifyResult => {
    const r: VerifyResult = {
      at: new Date().toISOString(),
      checkpoint: target,
      verdict,
      isolation: "host",
      network: { policy, enforcedBy: sandbox?.name ?? null },
      command,
      durationMs: Date.now() - started,
      exitCode,
      reason,
      log,
    };
    recordVerdict(p, r, manifest?.integrity ?? null);
    audit(p, "verify", target, verdict);
    return r;
  };
  // A check the user stopped proves nothing, so it never overwrites the verdict the save point had.
  const stopped = (log: string | null = null): VerifyResult => {
    audit(p, "verify-stopped", target, "INCOMPLETE");
    return {
      at: new Date().toISOString(), checkpoint: target, verdict: "INCOMPLETE", isolation: "host", network: { policy, enforcedBy: sandbox?.name ?? null },
      command, durationMs: Date.now() - started, exitCode: null, reason: "You stopped the check before it finished.", log, stopped: true,
    };
  };

  let manifest: Manifest | null = null;
  try {
    manifest = readManifest(p, target);
  } catch (e) {
    if (e instanceof TmError && e.kind === "integrity") return finish("ERROR", e.message);
    throw e;
  }
  if (opts.signal?.aborted) return stopped();
  if (!cfg.verify.command.trim()) return finish("BLOCKED", "No check is set up. Add verify.command to timemachine.yml, for example npm test.");
  if (policy === "deny" && !sandbox) {
    return finish("BLOCKED", "The network is set to deny, but no sandbox is available to enforce it, so the check did not run. Install bubblewrap (Linux), or set verify.network to allow in timemachine.yml.");
  }

  const parent = mkdtempSync(join(tmpdir(), `tm-verify-${target}-`));
  const dir = join(parent, p.name);
  const cleanup = (): void => {
    removeWorktree(p, dir);
    rmSync(parent, { recursive: true, force: true });
  };
  const dispose = onInterrupt(cleanup);
  try {
    let m;
    try {
      m = materialize(p, manifest, dir);
    } catch (e) {
      if (e instanceof TmError && e.kind === "integrity") return finish("ERROR", e.message);
      if (e instanceof TmError && e.kind === "not_found") return finish("INCOMPLETE", `${e.message} The check was not run.`);
      throw e;
    }
    const notSaved = [...m.missing, ...manifest.coverage.missing];
    if (notSaved.length) return finish("INCOMPLETE", `Some saved files are missing: ${notSaved.join(", ")}. The check was not run.`);
    const env = cleanEnv(p.env, m.plainEnv);
    const deadline = Date.now() + cfg.verify.timeoutSeconds * 1000;
    const logPath = join(p.store, "logs", `${target}-${stamp()}.log`);
    const secrets = secretValues([p.root, dir], cfg);
    let log = "";
    // Setup (for example npm ci) may need the network to install dependencies, so it runs
    // outside the sandbox. Only the check itself runs under the network policy.
    if (cfg.verify.setup.trim()) {
      const s = await runWithTimeout("/bin/sh", ["-c", cfg.verify.setup], { cwd: dir, env, timeoutMs: deadline - Date.now(), signal: opts.signal });
      log += `$ ${cfg.verify.setup}\n${s.output}\n`;
      if (s.stopped) {
        writeFileSync(logPath, redact(log, secrets));
        return stopped(logPath);
      }
      const judged = judge(s, cfg.verify.timeoutSeconds);
      if (judged.verdict !== "PASS") {
        writeFileSync(logPath, redact(log, secrets));
        // A failed install does not prove the code is broken (the network or a proxy may be
        // the cause), so it is INCOMPLETE, never FAIL. Timeouts and crashes stay ERROR.
        if (judged.verdict === "FAIL") return finish("INCOMPLETE", `The setup step failed with exit code ${s.code}, so the check did not run. See the log.`, s.code, logPath);
        return finish(judged.verdict, `Setup: ${judged.reason}`, s.code, logPath);
      }
    }
    const [file, args] = sandbox ? sandbox.wrap(cfg.verify.command) : ["/bin/sh", ["-c", cfg.verify.command]];
    const r = await runWithTimeout(file, args, { cwd: dir, env, timeoutMs: Math.max(1, deadline - Date.now()), signal: opts.signal });
    log += `$ ${cfg.verify.command}\n${r.output}`;
    writeFileSync(logPath, redact(log, secrets));
    if (r.stopped) return stopped(logPath);
    const { verdict, reason } = judge(r, cfg.verify.timeoutSeconds);
    return finish(verdict, reason, r.code, logPath);
  } finally {
    dispose();
    cleanup();
  }
}
