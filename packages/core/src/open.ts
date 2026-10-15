import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { audit } from "./audit.js";
import { materialize } from "./materialize.js";
import { resolveProject } from "./project.js";
import { ensureStore, readManifest } from "./store.js";
import type { Ctx, OpenResult } from "./types.js";

export async function open(ctx: Ctx, id: string, opts: { dir?: string } = {}): Promise<OpenResult> {
  const p = resolveProject(ctx);
  ensureStore(p);
  const m = readManifest(p, id);
  const dir = opts.dir ? resolve(ctx.cwd, opts.dir) : join(tmpdir(), `tm-open-${p.name}-${id}-${randomBytes(3).toString("hex")}`);
  const r = materialize(p, m, dir);
  audit(p, "open", id, "opened");
  return { id, dir, isolation: "host", restored: r.restored, missing: r.missing, manual: r.manual };
}
