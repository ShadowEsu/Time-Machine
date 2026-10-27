// A project whose folder moved: point it at the new path and keep its history. The store folder is
// named from the path, so it moves with the project; save points, settings, notes and checks stay.
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { audit } from "./audit.js";
import { TmError } from "./errors.js";
import { requireGit } from "./git.js";
import { isInside, realish } from "./paths.js";
import { gitRoot, projectFromStore, readMeta, resolveProject, storeFor, tmHome, writeMeta, type ProjectKind } from "./project.js";
import { readManifest, listIds, withLock } from "./store.js";
import { tmRefs } from "./timeline.js";
import type { Ctx } from "./types.js";

/**
 * Moves the project at ctx.cwd (its old path, which may be gone) to `newRoot`, keeping its id and history.
 * The new path is checked like a new project: an existing folder, outside the store, not protected
 * already. A Git project's new path must be the same repository: its save point refs must be there.
 */
export async function relinkProject(ctx: Ctx, newRoot: string): Promise<{ root: string; kind: ProjectKind; store: string }> {
  // The store knows the old path even when the folder, and a Git project's history with it, is gone. That path skips
  // resolveProject, so the Git version is checked here before anything changes.
  requireGit(ctx.env ?? process.env);
  const home = tmHome(ctx);
  const p = projectFromStore(home, storeFor(home, realish(resolve(ctx.cwd))), ctx.env ?? process.env) ?? resolveProject(ctx);
  const given = newRoot.trim().replace(/^~(?=$|\/)/, homedir());
  if (!given) throw new TmError("usage", "Enter the folder's new path.");
  if (!isAbsolute(given)) throw new TmError("usage", `${given} is not a full path. Give the folder's new path from the top, like /Users/you/Documents/Thesis.`);
  const st = statSync(given, { throwIfNoEntry: false });
  if (!st) throw new TmError("usage", `${given} does not exist. Pick the folder where ${p.name} is now.`);
  if (!st.isDirectory()) throw new TmError("usage", `${given} is a file, not a folder.`);
  const root = realish(given);
  if (root === p.root) throw new TmError("usage", `${p.name} is already at ${root}.`);
  if (isInside(root, p.home)) throw new TmError("usage", `The Time Machine store (${p.home}) is inside ${root}. Pick another folder.`);
  if (isInside(p.home, root)) throw new TmError("usage", `${root} is inside the Time Machine store. Pick another folder.`);
  const store = storeFor(p.home, root);
  if (existsSync(store)) {
    const other = readMeta(store);
    throw new TmError("usage", `${root} already has its own history in Time Machine${other ? "" : " (an empty store folder)"}, so ${p.name} was not moved there.`);
  }
  if (p.kind === "folder") {
    // The nearest protected folder above the new path would take in its files too.
    try {
      const above = resolveProject({ ...ctx, cwd: root });
      if (above.kind === "folder" && above.root !== p.root) throw new TmError("usage", `${root} is inside ${above.root}, which Time Machine already protects.`);
    } catch (e) {
      if (e instanceof TmError && e.kind === "usage") throw e;
    }
  } else {
    if (gitRoot({ ...ctx, cwd: root, env: p.env }) !== root) throw new TmError("usage", `${root} is not the top folder of a Git repository, so it can't be ${p.name}.`);
    const moved = { ...p, root };
    const refs = tmRefs(moved);
    const newest = listIds(p).at(-1);
    if (newest) {
      const m = readManifest(p, newest);
      if (refs?.get(newest) !== m.git.snapshot) throw new TmError("usage", `${root} is not the same Git repository as ${p.name}: its save point ${newest} is not there.`);
    }
  }
  await withLock(p, async () => {
    renameSync(p.store, store);
    // The lock moved with the store folder; it is this command's, so it goes.
    rmSync(join(store, "lock"), { recursive: true, force: true });
  });
  // A Git project's common dir is looked up again at the new path.
  const { gitCommonDir: _stale, ...meta } = readMeta(store) ?? { storeVersion: 1 as const, createdAt: new Date().toISOString() };
  writeMeta(store, { ...meta, root, movedFrom: p.root, movedAt: new Date().toISOString() });
  const moved = resolveProject({ ...ctx, cwd: root });
  audit(moved, "relink", null, "moved from its old path");
  return { root: moved.root, kind: moved.kind, store: moved.store };
}
