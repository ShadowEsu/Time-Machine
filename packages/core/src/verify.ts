import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "./audit.js";
import { loadConfig, type ProjectConfig } from "./config.js";
import { TmError } from "./errors.js";
import { runWithTimeout, type TimedResult } from "./exec.js";
import { materialize, removeWorktree } from "./materialize.js";
import { resolveProject, type Project } from "./project.js";
import { detectSandbox } from "./sandbox.js";
import { looksSecret, parseDotenv, redact } from "./secrets.js";
import { ensureStore, listIds, readManifest, stamp } from "./store.js";
import type { Ctx, VerifyResult } from "./types.js";
import type { Verdict } from "./verdict.js";
import { recordVerdict } from "./verdicts.js";

const KEEP_ENV = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR", "SHELL", "SystemRoot"];

function cleanEnv(base: NodeJS.ProcessEnv, plain: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of KEEP_ENV) if (base[k] !== undefined) env[k] = base[k];
  return { ...env, ...plain, CI: "1", NO_COLOR: "1", TM_VERIFY: "1" };
}

/** Current secret values, used only to scrub them from check logs. Never stored. */
function secretValues(p: Project, cfg: ProjectConfig): string[] {
  const out: string[] = [];
  for (const file of cfg.config.files) {
    const full = join(p.root, file);
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

export async function verify(ctx: Ctx, id?: string): Promise<VerifyResult> {
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
    recordVerdict(p, r);
    audit(p, "verify", target, verdict);
    return r;
  };

  let manifest;
  try {
    manifest = readManifest(p, target);
  } catch (e) {
    if (e instanceof TmError && e.kind === "integrity") return finish("ERROR", e.message);
    throw e;
  }
  if (!cfg.verify.command.trim()) return finish("BLOCKED", "No check is set up. Add verify.command to timemachine.yml, for example npm test.");
  if (policy === "deny" && !sandbox) {
    return finish("BLOCKED", "The network is set to deny, but no sandbox is available to enforce it, so the check did not run. Install bubblewrap (Linux), or set verify.network to allow in timemachine.yml.");
  }

  const parent = mkdtempSync(join(tmpdir(), `tm-verify-${target}-`));
  const dir = join(parent, p.name);
  try {
    let m;
    try {
      m = materialize(p, manifest, dir);
    } catch (e) {
      if (e instanceof TmError && e.kind === "integrity") return finish("ERROR", e.message);
      throw e;
    }
    const notSaved = [...m.missing, ...manifest.coverage.missing];
    if (notSaved.length) return finish("INCOMPLETE", `Some saved files are missing: ${notSaved.join(", ")}. The check was not run.`);
    const env = cleanEnv(p.env, m.plainEnv);
    const deadline = Date.now() + cfg.verify.timeoutSeconds * 1000;
    const logPath = join(p.store, "logs", `${target}-${stamp()}.log`);
    const secrets = secretValues(p, cfg);
    let log = "";
    // Setup (for example npm ci) may need the network to install dependencies, so it runs
    // outside the sandbox. Only the check itself runs under the network policy.
    if (cfg.verify.setup.trim()) {
      const s = await runWithTimeout("/bin/sh", ["-c", cfg.verify.setup], { cwd: dir, env, timeoutMs: deadline - Date.now() });
      log += `$ ${cfg.verify.setup}\n${s.output}\n`;
      const judged = judge(s, cfg.verify.timeoutSeconds);
      if (judged.verdict !== "PASS") {
        writeFileSync(logPath, redact(log, secrets));
        const reason = judged.verdict === "FAIL" ? `The setup step failed with exit code ${s.code}, so the check did not run.` : `Setup: ${judged.reason}`;
        return finish(judged.verdict, reason, s.code, logPath);
      }
    }
    const [file, args] = sandbox ? sandbox.wrap(cfg.verify.command) : ["/bin/sh", ["-c", cfg.verify.command]];
    const r = await runWithTimeout(file, args, { cwd: dir, env, timeoutMs: Math.max(1, deadline - Date.now()) });
    log += `$ ${cfg.verify.command}\n${r.output}`;
    writeFileSync(logPath, redact(log, secrets));
    const { verdict, reason } = judge(r, cfg.verify.timeoutSeconds);
    return finish(verdict, reason, r.code, logPath);
  } finally {
    removeWorktree(p, dir);
    rmSync(parent, { recursive: true, force: true });
  }
}
