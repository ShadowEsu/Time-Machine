import { createHash, createHmac, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { TmError } from "./errors.js";
import { ManifestSchema, type Manifest } from "./manifest.js";
import type { Project } from "./project.js";

export { storeDirFor } from "./project.js";

const DIRS = ["objects", "checkpoints", "bundles", "logs", "reports"];

export function ensureStore(p: Project): void {
  for (const d of DIRS) mkdirSync(join(p.store, d), { recursive: true });
  const meta = join(p.store, "project.json");
  if (!existsSync(meta)) writeFileSync(meta, JSON.stringify({ storeVersion: 1, root: p.root, createdAt: new Date().toISOString() }, null, 2) + "\n");
}

/** Per-store key for fingerprints and manifest integrity. Never leaves this machine. */
export function storeKey(p: Project): Buffer {
  const path = join(p.home, "key");
  if (!existsSync(path)) {
    mkdirSync(p.home, { recursive: true });
    try {
      writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  return readFileSync(path);
}

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function blobPath(p: Project, sha: string): string {
  return join(p.store, "objects", sha.slice(0, 2), `${sha.slice(2)}.gz`);
}

export function putBlob(p: Project, buf: Buffer): string {
  const sha = sha256(buf);
  const path = blobPath(p, sha);
  if (existsSync(path)) return sha;
  mkdirSync(join(p.store, "objects", sha.slice(0, 2)), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, gzipSync(buf));
  chmodSync(tmp, 0o444);
  renameSync(tmp, path);
  return sha;
}

/** Returns null when the blob is missing. Throws when it does not match its hash. */
export function getBlob(p: Project, sha: string, label: string): Buffer | null {
  const path = blobPath(p, sha);
  if (!existsSync(path)) return null;
  let buf: Buffer;
  try {
    buf = gunzipSync(readFileSync(path));
  } catch {
    throw new TmError("integrity", `Saved copy of ${label} failed its integrity check. It cannot be read.`);
  }
  if (sha256(buf) !== sha) throw new TmError("integrity", `Saved copy of ${label} failed its integrity check. It was changed after it was saved.`);
  return buf;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Signs a record with the store key. This catches accidental edits and edits by tools
 * that do not read the key. It cannot stop someone who can read the key file.
 */
export function sign(p: Project, body: unknown): string {
  return createHmac("sha256", storeKey(p)).update(canonical(body)).digest("hex");
}

function seal(p: Project, body: Omit<Manifest, "integrity">): string {
  return sign(p, body);
}

/** Hands out checkpoint numbers that are never reused, even if a manifest is deleted. */
export function nextNumber(p: Project): number {
  const path = join(p.store, "counter");
  const fromFile = existsSync(path) ? Number(readFileSync(path, "utf8").trim()) || 0 : 0;
  const last = listIds(p).at(-1);
  const n = Math.max(fromFile, last ? Number(last.slice(3)) : 0) + 1;
  writeFileSync(path, `${n}\n`);
  return n;
}

export function writeManifest(p: Project, body: Omit<Manifest, "integrity">): Manifest {
  const manifest: Manifest = { ...body, integrity: seal(p, body) };
  const path = join(p.store, "checkpoints", `${body.id}.json`);
  const fd = openSync(path, "wx", 0o444);
  try {
    writeSync(fd, JSON.stringify(manifest, null, 2) + "\n");
  } finally {
    closeSync(fd);
  }
  return manifest;
}

export function listIds(p: Project): string[] {
  const dir = join(p.store, "checkpoints");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^cp-\d{4,}\.json$/.test(f))
    .map((f) => f.slice(0, -5))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

export function readManifest(p: Project, id: string): Manifest {
  if (!/^cp-\d{4,}$/.test(id)) throw new TmError("usage", `"${id}" is not a checkpoint ID. IDs look like cp-0003.`);
  const path = join(p.store, "checkpoints", `${id}.json`);
  if (!existsSync(path)) throw new TmError("not_found", `There is no checkpoint ${id}. Run tm timeline to see them.`);
  const bad = (): TmError => new TmError("integrity", `${id} failed its integrity check. It was changed after it was saved, so Time Machine will not use it.`);
  let parsed: Manifest;
  try {
    parsed = ManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw bad();
  }
  const { integrity, ...body } = parsed;
  if (parsed.id !== id || seal(p, body) !== integrity) throw bad();
  return parsed;
}

export function appendJsonl(path: string, entry: unknown): void {
  appendFileSync(path, JSON.stringify(entry) + "\n");
}

export function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

const LOCK_MAX_AGE_MS = 120_000;

/** Written to lock/owner right after the lock is taken, so a waiter can tell a crashed holder from a busy one. */
const LockOwnerSchema = z.object({ pid: z.number().int().positive(), host: z.string(), token: z.string().min(1) });

function readLockOwner(dir: string): z.infer<typeof LockOwnerSchema> | undefined {
  try {
    const r = LockOwnerSchema.safeParse(JSON.parse(readFileSync(join(dir, "owner"), "utf8")));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Whether a lock may be taken over, and the owner token seen at the time.
 * Only a holder on this machine whose process is gone is taken over at once. A lock with no owner
 * file (an older version, or a crash before the owner was written) or from another machine waits
 * out the two minute rule.
 */
function staleLock(dir: string): { token: string | undefined } | undefined {
  const owner = readLockOwner(dir);
  if (owner && owner.host === hostname() && !pidAlive(owner.pid)) return { token: owner.token };
  try {
    if (Date.now() - statSync(dir).mtimeMs > LOCK_MAX_AGE_MS) return { token: owner?.token };
  } catch {
    // The lock went away between calls.
  }
  return undefined;
}

/**
 * Removes a stale lock without racing other waiters: move it aside first, then delete it only if it is
 * still the stale lock we looked at. If another command took the lock in between, put it back.
 */
function reclaimStaleLock(lock: string): void {
  const seen = staleLock(lock);
  if (!seen) return;
  const aside = `${lock}.stale-${randomBytes(8).toString("hex")}`;
  try {
    renameSync(lock, aside);
  } catch {
    return; // Someone else moved or removed it first.
  }
  const moved = staleLock(aside);
  if (moved && moved.token === seen.token) {
    rmSync(aside, { recursive: true, force: true });
    return;
  }
  try {
    renameSync(aside, lock);
  } catch {
    // Another command took the lock in this tiny window, so the one we moved cannot go back. Its holder
    // will not find its token on release and leaves the new lock alone; drop the moved copy so it does not pile up.
    rmSync(aside, { recursive: true, force: true });
  }
}

/** A simple cross-process lock so two checkpoints never take the same ID. */
export async function withLock<T>(p: Project, fn: () => Promise<T>): Promise<T> {
  const lock = join(p.store, "lock");
  const token = randomBytes(16).toString("hex");
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (takeLock(lock, token)) break;
    reclaimStaleLock(lock);
    if (Date.now() > deadline) throw new TmError("internal", "Another Time Machine command is still saving. Try again in a moment.");
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    return await fn();
  } finally {
    // If the lock was taken over while we ran, it is someone else's now. Leave it.
    if (readLockOwner(lock)?.token === token) rmSync(lock, { recursive: true, force: true });
  }
}

function takeLock(lock: string, token: string): boolean {
  try {
    mkdirSync(lock);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  try {
    writeFileSync(join(lock, "owner"), JSON.stringify({ pid: process.pid, host: hostname(), token }), { flag: "wx" });
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // A waiter moved our fresh folder aside, or put an older lock back over it. We do not hold the lock.
    if (code === "ENOENT" || code === "EEXIST") return false;
    rmSync(lock, { recursive: true, force: true });
    throw e;
  }
}

export function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-");
}
