import { chmodSync, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** A path saved in a manifest must be relative and stay inside the project. */
export function isSafeRelPath(p: string): boolean {
  if (!p || isAbsolute(p) || p.includes("\\") || p.includes("\0")) return false;
  return p.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** Resolves symbolic links in the part of the path that exists (macOS /var is /private/var), in the letter case on disk. */
export function realish(p: string): string {
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

/**
 * Runs `fn` with the working folder pinned to the folder `relDir` inside `root` (each part made first when `make`), so the
 * names `fn` uses stay in that folder: a folder on the way swapped for a symbolic link can't send them elsewhere. Each part
 * is entered on its own, then the folder reached is checked to be inside `root`; a pinned working folder doesn't move when
 * a path is swapped later. `{ inside: false }` when it isn't inside. Synchronous only (chdir throws in worker threads);
 * the working folder is put back after.
 */
export function inPinnedDir<T>(root: string, relDir: string, make: boolean, fn: () => T): { inside: false } | { inside: true; value: T } {
  let home: string | null;
  try {
    home = process.cwd();
  } catch {
    home = null; // the working folder was deleted: it ends at root
  }
  // The root is resolved once and entered as resolved, and the end check compares with that same path: a root swapped
  // after this can't move both sides of the check at once.
  const rootReal = realish(root);
  try {
    process.chdir(rootReal);
    const top = statSync(".");
    const rootNow = statSync(rootReal);
    if (top.dev !== rootNow.dev || top.ino !== rootNow.ino) return { inside: false };
    for (const part of relDir ? relDir.split("/") : []) {
      if (make && !lstatSync(part, { throwIfNoEntry: false })) mkdirSync(part);
      const st = lstatSync(part, { throwIfNoEntry: false });
      if (!st?.isDirectory()) return { inside: false };
      process.chdir(part);
      // The folder entered is the one just looked at: a swap for a symbolic link in between would have moved the working
      // folder outside before the last check, and a later part could be made there.
      const here = statSync(".");
      if (here.dev !== st.dev || here.ino !== st.ino) return { inside: false };
    }
    const rel = relative(rootReal, realpathSync.native("."));
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) return { inside: false };
    return { inside: true, value: fn() };
  } finally {
    // Putting the working folder back never hides what fn returned or threw: a folder gone meanwhile falls back to root, then
    // to the home folder, so the process never stays in a folder a later swap could move (Security N3).
    for (const back of [() => home ?? root, () => root, () => homedir(), () => "/"]) {
      try {
        process.chdir(back());
        break;
      } catch {
        // Try the next one.
      }
    }
  }
}
