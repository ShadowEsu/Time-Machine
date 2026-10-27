import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { audit } from "./audit.js";
import { TmError } from "./errors.js";
import { materialize } from "./materialize.js";
import { isInside } from "./paths.js";
import { resolveProject } from "./project.js";
import { ensureStore, readManifest } from "./store.js";
import type { Ctx, OpenResult } from "./types.js";

/** Rebuilds a save point in a separate folder. Works for a plain folder that was moved or deleted too: its history is in the store. */
export async function open(ctx: Ctx, id: string, opts: { dir?: string } = {}): Promise<OpenResult> {
  const p = resolveProject(ctx);
  ensureStore(p);
  const m = readManifest(p, id);
  const dir = opts.dir ? resolve(ctx.cwd, opts.dir) : join(tmpdir(), `tm-open-${p.name}-${id}-${randomBytes(3).toString("hex")}`);
  if (isInside(p.root, dir)) throw new TmError("usage", `${dir} is inside the project. Pick a folder outside it, so your working copy stays untouched.`);
  // A plain folder's safe copy is plain files, with no .git linking it to the store.
  const r = materialize(p, m, dir, { plain: p.kind === "folder" });
  audit(p, "open", id, r.missing.length ? "opened, incomplete" : "opened");
  return { id, dir, isolation: "host", restored: r.restored, missing: r.missing, manual: r.manual };
}
