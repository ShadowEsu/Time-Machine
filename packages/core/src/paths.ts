import { chmodSync, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** A path saved in a manifest must be relative and stay inside the project. */
export function isSafeRelPath(p: string): boolean {
  if (!p || isAbsolute(p) || p.includes("\\") || p.includes("\0")) return false;
  return p.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** Resolves symbolic links in the part of the path that exists (macOS /var is /private/var), in the letter case on disk. */
function realish(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(realish(parent), basename(abs));
  }
}

export function isInside(parent: string, child: string): boolean {
  const r = relative(realish(parent), realish(child));
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
}

/**
 * Makes `dir` (and any missing parents) open to this user only, and tightens `dir` if others could get
 * in. The store holds a copy of every saved file, so it must never be more open than the folders it copies.
 */
export function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (statSync(dir).mode & 0o077) chmodSync(dir, 0o700);
}

/**
 * Where to write `rel` inside `dir`, or null if any part of the way is a symbolic
 * link or a file, so a restore can never write outside the copy.
 */
export function safeTarget(dir: string, rel: string): string | null {
  if (!isSafeRelPath(rel)) return null;
  const parts = rel.split("/");
  let cur = dir;
  for (const [i, part] of parts.entries()) {
    cur = join(cur, part);
    try {
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) return null;
      if (i < parts.length - 1 && !st.isDirectory()) return null;
    } catch {
      // Does not exist yet. Nothing below it can be a link.
      break;
    }
  }
  return join(dir, ...parts);
}
