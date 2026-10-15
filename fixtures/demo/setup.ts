// Test helpers shared by the core and CLI suites.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpoint, type Ctx } from "@timetm/core";
import { buildDemo, git } from "./build.ts";

export interface Demo {
  root: string;
  dir: string;
  ctx: Ctx;
}

export function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `tm-${name}-`));
}

export function writeConfig(dir: string, verify: Record<string, string | number> = {}, configFiles: string[] = [".env"]): void {
  const v = { command: "node --test", timeoutSeconds: 60, network: "allow", ...verify };
  const lines = Object.entries(v).map(([k, val]) => `  ${k}: ${typeof val === "string" ? JSON.stringify(val) : val}`);
  writeFileSync(join(dir, "timemachine.yml"), `version: 1\nverify:\n${lines.join("\n")}\nconfig:\n  files: ${JSON.stringify(configFiles)}\n  plain: [PORT]\n`);
}

/** Builds the demo and saves a checkpoint after every step: cp-0001 to cp-0006. */
export async function setupDemo(): Promise<Demo> {
  const root = tempDir("demo");
  const dir = join(root, "marigold");
  const tmHome = join(root, "store");
  const ctx: Ctx = { cwd: dir, tmHome, env: { ...process.env, TM_HOME: tmHome } };
  await buildDemo(dir, async (step, i) => {
    if (i === 0) writeConfig(dir);
    await checkpoint(ctx, { note: step.note });
  });
  return { root, dir, ctx };
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Every non-ignored file in a folder (tracked or not) with its hash. */
export function fileMap(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const list = git(dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0").filter(Boolean);
  for (const p of list.sort()) {
    try {
      out[p] = sha(join(dir, p));
    } catch {
      // Listed in the index but deleted on disk. Absent is the truth.
    }
  }
  return out;
}

/** Everything a user would notice changing: branch, HEAD, index, every file including ignored ones. */
export function snapshotState(dir: string): Record<string, unknown> {
  const all = git(dir, "ls-files", "-z", "--cached", "--others").split("\0").filter(Boolean);
  const files: Record<string, string> = {};
  for (const p of all.sort()) {
    try {
      files[p] = sha(join(dir, p));
    } catch {
      files[p] = "deleted";
    }
  }
  return {
    head: git(dir, "rev-parse", "HEAD"),
    branch: git(dir, "symbolic-ref", "HEAD"),
    index: git(dir, "ls-files", "-s"),
    branches: git(dir, "branch", "--list"),
    files,
  };
}
