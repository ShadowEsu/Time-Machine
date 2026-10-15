import { lstatSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** A path saved in a manifest must be relative and stay inside the project. */
export function isSafeRelPath(p: string): boolean {
  if (!p || isAbsolute(p) || p.includes("\\") || p.includes("\0")) return false;
  return p.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function isInside(parent: string, child: string): boolean {
  const r = relative(resolve(parent), resolve(child));
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
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
