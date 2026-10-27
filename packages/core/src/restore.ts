// Puts one file or folder back from a save point into the live folder. The folder is saved first
// ("before-restore"), so every version this overwrites stays in History. Nothing is ever deleted.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants as fsConstants, copyFileSync, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, type Stats, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { audit } from "./audit.js";
import { TmError } from "./errors.js";
import { checkpoint } from "./folder.js";
import { gitBlob, gitCleanId, gitTry, splitZ } from "./git.js";
import { isJunkFile } from "./junk.js";
import type { Manifest } from "./manifest.js";
import { checkRef } from "./materialize.js";
import { inPinnedDir, isSafeRelPath, safeTarget } from "./paths.js";
import { assertOwnGitDir, resolveProject, type Project } from "./project.js";
import { isSecretFileName } from "./secrets.js";
import { getBlob, readManifest, sha256 } from "./store.js";
import type { Ctx, RestoreResult } from "./types.js";

const SECRETS = "a secrets file, which Time Machine never saves or writes";
const CONFIG = "a config file: its keys are recorded, not its text, so it was not written";
const LINK = "a symbolic link is in the way, so it was not written";
const GIT_DIR = "inside .git, which Time Machine never writes";
const CHANGED = "it changed while putting back, so it was not replaced";
const APPEARED = "a file appeared there while putting back, so it was not replaced";

const PathsSchema = z.array(z.string()).min(1);

/**
 * One file in a save point. A plain folder's files and a Git project's untracked files are in the store
 * (`store`, with their exact mode); a Git project's tracked files are in its snapshot commit (`blob`).
 */
interface Saved {
  path: string;
  store?: string;
  blob?: string;
  /** The exact saved mode. A Git blob only says whether the file runs (`exec`). */
  mode?: number;
  exec?: boolean;
  /** Why it can't be written as a file: a symbolic link or a nested repository in the commit. */
  special?: string;
}

/** Every file the save point holds, by path. */
function savedFiles(p: Project, m: Manifest): Map<string, Saved> {
  const out = new Map<string, Saved>();
  const tree = gitTry(p.root, p.env, ["ls-tree", "-r", "-z", "--full-tree", m.git.snapshot]);
  if (tree.code !== 0) throw new TmError("internal", `git ls-tree failed: ${tree.stderr.trim()}`);
  for (const entry of splitZ(tree.stdout)) {
    const tab = entry.indexOf("\t");
    const [mode = "", , blob = ""] = entry.slice(0, tab).split(" ");
    const path = entry.slice(tab + 1);
    const special = mode === "120000" ? "a symbolic link in the save point, so it was not written" : mode === "160000" ? "a nested Git repository, so it was not written" : undefined;
    out.set(path, { path, blob, exec: mode === "100755", ...(special ? { special } : {}) });
  }
  for (const f of m.files) out.set(f.path, { path: f.path, store: f.sha256, mode: f.mode });
  return out;
}

/** Why `rel` can't be written inside `root`: a symbolic link, or a file where the save point has a folder. */
function inTheWay(root: string, rel: string): string {
  let cur = root;
  for (const part of rel.split("/")) {
    cur = join(cur, part);
    if (lstatSync(cur, { throwIfNoEntry: false })?.isSymbolicLink()) return LINK;
  }
  return "a file is in the way where the save point has a folder, so it was not written";
}

/** Files under the folder `rel` that are there now, as a save would see them (ignored files are not listed). */
function liveFilesUnder(p: Project, rel: string): string[] {
  const r = gitTry(p.root, p.env, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", rel], { GIT_LITERAL_PATHSPECS: "1" });
  if (r.code !== 0) throw new TmError("internal", `git ls-files failed: ${r.stderr.trim()}`);
  return [...new Set(splitZ(r.stdout))].filter((f) => f.startsWith(`${rel}/`) && !isJunkFile(f) && lstatSync(join(p.root, f), { throwIfNoEntry: false }));
}

/** What a file there now looked like when the plan read it. Any change by the time of the write means someone else wrote it. */
interface Seen {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  dev: number;
}

/** What a file there now held when the plan read it: its sha256 and size. Neither the plan nor the write step keeps a whole
 *  folder's bytes in memory, only one file at a time (Security F7). */
interface Current {
  sha: string;
  size: number;
}

interface Planned {
  path: string;
  /** Where the saved bytes are; read again when this file is written, and checked against `savedSha`. */
  source: Saved;
  /** The sha256 of the saved bytes the plan compared. A re-read that differs (a replaced Git object) is never written. */
  savedSha: string;
  mode: number;
  /** Not there now. */
  added: boolean;
  /** What is there now, or null when it could not be read. Only for a file that is there. */
  current: Current | null;
  /** Its stat when the plan read it. Only for a file that is there. */
  seen: Seen | null;
}

/** The saved bytes of `s`, or null when they are gone. */
function loadSaved(p: Project, s: Saved): Buffer | null {
  return s.store !== undefined ? getBlob(p, s.store, s.path) : gitBlob(p.root, p.env, s.blob ?? "");
}

const seenOf = (st: Stats): Seen => ({ size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, dev: st.dev });
const sameSeen = (a: Seen, b: Seen): boolean => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev;

/** Read only, never through a symbolic link, never waiting on a pipe swapped in (Security A1). */
const PLAIN_READ = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);

/** An open descriptor on the plain file at `full`, or null when it is not a plain file or can't be opened. */
function openPlain(full: string): number | null {
  let fd: number;
  try {
    fd = openSync(full, PLAIN_READ);
  } catch {
    return null;
  }
  try {
    if (fstatSync(fd).isFile()) return fd;
  } catch {
    // fall through: closed below
  }
  closeSync(fd);
  return null;
}

/** The sha256 and size of what `fd` holds, read in chunks; null past `limit` bytes (a file that keeps growing). */
function hashFd(fd: number, limit: number): Current | null {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1 << 16);
  let size = 0;
  for (let n = readSync(fd, chunk, 0, chunk.length, 0); n > 0; n = readSync(fd, chunk, 0, chunk.length, size)) {
    hash.update(chunk.subarray(0, n));
    size += n;
    if (size > limit) return null;
  }
  return { sha: hash.digest("hex"), size };
}

/** No file a save keeps is over 1 GiB (capture.maxFileMB's cap). */
const HASH_LIMIT = 1024 * 1024 * 1024;

/** What is at `full` now, read through one descriptor: its hash and the stat of exactly what was read. */
function readPlain(full: string): { current: Current; seen: Seen } | null {
  const fd = openPlain(full);
  if (fd === null) return null;
  try {
    const seen = seenOf(fstatSync(fd));
    const current = hashFd(fd, HASH_LIMIT);
    // Changed while it was read: no one stat describes what was hashed.
    return current && sameSeen(seenOf(fstatSync(fd)), seen) ? { current, seen } : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The bytes at `full` now, if it is a plain file. */
function bytesNow(full: string): Buffer | null {
  const fd = openPlain(full);
  if (fd === null) return null;
  try {
    return readFileSync(fd);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** True when the file at `full` is still exactly what the plan read: same stat (R1) and same bytes (N1), hashed on one descriptor. */
function stillSame(full: string, seen: Seen, current: Current): boolean {
  const fd = openPlain(full);
  if (fd === null) return false;
  try {
    if (!sameSeen(seenOf(fstatSync(fd)), seen) || seen.size !== current.size) return false;
    const now = hashFd(fd, current.size);
    // The stat again after the bytes: an edit while hashing changes it (Security F7 LOW).
    return now !== null && now.size === current.size && now.sha === current.sha && sameSeen(seenOf(fstatSync(fd)), seen);
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes one file through a temp file next to it, so a reader never sees half a file. A file there is replaced by a
 * rename only if it is exactly what the plan read (and the save first holds); a file that was not there is linked
 * into place, which fails if one appeared meanwhile. The file gets today's time, as a checkout does, so build tools
 * see the change. `buf` is the saved bytes, loaded just for this file. Returns why it was not written, or null.
 */
function writeFile(root: string, x: Planned, buf: Buffer): string | null {
  // Checked again: the folder may have changed since the plan.
  if (!safeTarget(root, x.path)) return inTheWay(root, x.path);
  const parts = x.path.split("/");
  const name = parts.pop() ?? x.path;
  // Every step uses names in the file's own folder, entered part by part and pinned as the working folder: a folder on the
  // way swapped for a symbolic link can't send the temp file or the file outside the project (Security F6).
  try {
    const r = inPinnedDir(root, parts.join("/"), true, () => writeHere(name, x, buf));
    return r.inside ? r.value : LINK;
  } catch (e) {
    return `could not be written (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`;
  }
}

/** writeFile's work inside the pinned folder: `name` is a plain name there. */
function writeHere(name: string, x: Planned, buf: Buffer): string | null {
  const st = lstatSync(name, { throwIfNoEntry: false });
  if (st && !st.isFile()) return `${st.isDirectory() ? "a folder" : "something that is not a file"} is there now, so it was not replaced`;
  const tmp = `.${name}.tm-restore-${randomBytes(4).toString("hex")}`;
  let made = false;
  try {
    // Created new (never through a link) and given its mode through the same descriptor, so a swap can't redirect it (N4).
    const fd = openSync(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), x.mode & 0o777);
    made = true;
    try {
      writeFileSync(fd, buf);
      fchmodSync(fd, x.mode & 0o777);
    } finally {
      closeSync(fd);
    }
    if (x.seen) {
      // The last look before the rename: an edit made after the save first is never overwritten (Security R1). The bytes
      // are compared too, since a same-size edit within one timestamp tick (HFS+, exFAT) leaves the stat the same (N1).
      if (x.current === null || !stillSame(name, x.seen, x.current)) {
        rmSync(tmp, { force: true });
        return CHANGED;
      }
      renameSync(tmp, name);
      return null;
    }
    try {
      linkSync(tmp, name);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        rmSync(tmp, { force: true });
        return APPEARED;
      }
      // A disk without hard links: an exclusive copy still never replaces a file that appeared.
      if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EXDEV") throw e;
      copyFileSync(tmp, name, fsConstants.COPYFILE_EXCL);
    }
    rmSync(tmp, { force: true });
    return null;
  } catch (e) {
    if (made) rmSync(tmp, { force: true });
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return APPEARED;
    return `could not be written (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`;
  }
}

/**
 * Puts files back from save point `id` into the live folder. A path names a file or a folder (everything
 * under it), relative to the project's folder. Paths outside the folder or inside .git, secrets files, config files
 * and paths the save point does not have are skipped by name. The folder is saved first (trigger "before-restore")
 * when anything will be written. Each file is written through a temp file, with its saved mode and today's time,
 * never through a symbolic link, and never over a file that changed after the plan read it. Files the save point lacks
 * are kept, never deleted. A Git project gets files only: its index, branch and commits are not touched. `dryRun`
 * reports the same and writes nothing.
 */
export async function restorePaths(ctx: Ctx, id: string, paths: string[], opts: { dryRun?: boolean } = {}): Promise<RestoreResult> {
  const asked = PathsSchema.safeParse(paths);
  if (!asked.success) throw new TmError("usage", "Name at least one file or folder to put back.");
  const p = resolveProject(ctx);
  if (p.missing) throw new TmError("not_found", `Can't find ${p.root}; use recover to a chosen folder: tm recover ${id} --to <folder>.`);
  assertOwnGitDir(p);
  const m = readManifest(p, id);
  checkRef(p, m);
  const saved = savedFiles(p, m);
  const configFiles = new Set(m.config.map((c) => c.file));
  const dryRun = opts.dryRun === true;

  const skipped: string[] = [];
  const kept = new Set<string>();
  const wanted = new Map<string, Saved>();
  for (const given of asked.data) {
    const rel = given.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
    if (!isSafeRelPath(rel)) skipped.push(`${given}: not a path inside the project`);
    else if (rel.split("/").includes(".git")) skipped.push(`${given}: ${GIT_DIR}`);
    else if (isSecretFileName(rel)) skipped.push(`${given}: ${SECRETS}`);
    else if (configFiles.has(rel)) skipped.push(`${given}: ${CONFIG}`);
    else {
      const exact = saved.get(rel);
      const under = exact ? [exact] : [...saved.values()].filter((s) => s.path.startsWith(`${rel}/`));
      if (!under.length) skipped.push(`${given}: not in ${id}`);
      for (const s of under) wanted.set(s.path, s);
      // Files there now that the save point lacks. Nothing is listed through a symbolic link.
      if (!exact && under.length && safeTarget(p.root, rel)) for (const f of liveFilesUnder(p, rel)) if (!saved.has(f)) kept.add(f);
    }
  }

  const plan: Planned[] = [];
  let same = 0;
  for (const s of [...wanted.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const why = s.special ?? (isSecretFileName(s.path) ? SECRETS : configFiles.has(s.path) ? CONFIG : null);
    if (why) {
      skipped.push(`${s.path}: ${why}`);
      continue;
    }
    const full = safeTarget(p.root, s.path);
    if (!full) {
      skipped.push(`${s.path}: ${inTheWay(p.root, s.path)}`);
      continue;
    }
    const st = lstatSync(full, { throwIfNoEntry: false });
    if (st && !st.isFile()) {
      skipped.push(`${s.path}: ${st.isDirectory() ? "a folder" : "something that is not a file"} is there now, so it was not replaced`);
      continue;
    }
    // Read once here to compare, then let go: the write step reads it again (F7).
    const buf = loadSaved(p, s);
    if (!buf) {
      skipped.push(`${s.path}: the saved copy is gone from the store`);
      continue;
    }
    const savedSha = s.store ?? sha256(buf);
    // A Git blob keeps only whether the file runs: the file keeps its own read and write bits, with run bits where it can be read.
    const live = st ? st.mode & 0o777 : null;
    const mode = s.mode ?? (live === null ? (s.exec ? 0o755 : 0o644) : (live & ~0o111) | (s.exec ? (live & 0o444) >> 2 : 0));
    let current: Current | null = null;
    let seen: Seen | null = st ? seenOf(st) : null;
    if (st) {
      // Can't be read as a plain file: it counts as changed, and is not replaced unless the save first holds it.
      const read = readPlain(full);
      current = read?.current ?? null;
      if (read) seen = read.seen;
    }
    if (current && live === mode && current.size === buf.length && current.sha === savedSha) {
      same++;
      continue;
    }
    plan.push({ path: s.path, source: s, savedSha, mode, added: !st, current, seen });
  }

  let done = plan;
  let savedBefore: string | null = null;
  if (!dryRun && plan.length) {
    savedBefore = (await checkpoint(ctx, { note: `Before restoring from ${id}`, trigger: "before-restore" })).checkpoint.id;
    // Only a version the save made first holds is replaced: a file the save left out (it looked secret, or could not be read) stays.
    const before = savedFiles(p, readManifest(p, savedBefore));
    done = plan.filter((x) => {
      if (!x.added) {
        const b = before.get(x.path);
        const heldBlob = x.current !== null && b?.store === undefined && b?.blob !== undefined ? gitBlob(p.root, p.env, b.blob) : null;
        const held = x.current !== null && b !== undefined && (b.store !== undefined ? b.store === x.current.sha : heldBlob !== null && sha256(heldBlob) === x.current.sha);
        if (!held) {
          // The save made first did hold it, in the form Git stores it: the bytes there now differ only by Git's conversion,
          // which this check can't undo, so the file stays and the reason is the real one (Security F12).
          const full = b?.blob !== undefined ? safeTarget(p.root, x.path) : null;
          const now = full ? bytesNow(full) : null;
          const converted = now !== null && b?.blob !== undefined && gitCleanId(p.root, p.env, x.path, now) === b.blob;
          skipped.push(converted
            ? `${x.path}: Git stores this file converted (its line endings, or Git LFS), so the version there now can't be checked against the save made first (${savedBefore}), and it was not replaced. tm open ${id} gives you the saved copy`
            : `${x.path}: the version there now could not be saved first (${savedBefore} left it out), so it was not replaced`);
          return false;
        }
      }
      // The saved bytes again, checked to be the ones the plan compared; a read error skips this file, so the loop ends and
      // the audit line is written (Security F7 LOW).
      let buf: Buffer | null;
      try {
        buf = loadSaved(p, x.source);
      } catch {
        buf = null;
      }
      const failed = buf === null ? "the saved copy is gone from the store" : sha256(buf) !== x.savedSha ? "the saved copy changed after the plan read it, so it was not written" : writeFile(p.root, x, buf);
      if (failed) skipped.push(`${x.path}: ${failed}`);
      return failed === null;
    });
  }
  if (!dryRun) audit(p, "restore", id, `${done.length} ${done.length === 1 ? "path" : "paths"}`);

  const added = done.filter((x) => x.added).length;
  return {
    id,
    dryRun,
    restored: done.map((x) => x.path),
    kept: [...kept].sort(),
    skipped,
    savedBefore,
    diff: { added, changed: done.length - added, same },
    ...(p.kind === "git" ? { note: dryRun ? "Nothing written; nothing committed." : "Files written; nothing committed." } : {}),
  };
}
