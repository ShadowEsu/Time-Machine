import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkpoint } from "./checkpoint.js";
import { TmError } from "./errors.js";
import { buildDemo } from "./demo-project.js";
import { findGood } from "./findGood.js";
import { init } from "./init.js";
import { recover } from "./recover.js";
import type { Ctx, DemoResult } from "./types.js";

/** Builds the synthetic Marigold Tips project, breaks it, and rescues it with the real engine. */
export async function demo(ctx: Ctx, opts: { dir?: string } = {}): Promise<DemoResult> {
  const dir = opts.dir ? resolve(ctx.cwd, opts.dir) : join(mkdtempSync(join(tmpdir(), "tm-demo-")), "marigold-tips");
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new TmError("usage", `${dir} is a file. The demo needs a new or empty folder.`);
    if (readdirSync(dir).length) throw new TmError("usage", `${dir} is not empty. The demo only builds in a new or empty folder.`);
  }
  const c: Ctx = { ...ctx, cwd: dir };
  const checkpoints: DemoResult["checkpoints"] = [];
  await buildDemo(dir, async (step, i) => {
    if (i === 0) await init(c);
    const r = await checkpoint(c, { note: step.note, trigger: "demo" });
    checkpoints.push({ id: r.checkpoint.id, note: step.note, expect: step.expect });
  });
  const good = await findGood(c);
  if (!good.found) throw new TmError("internal", `The demo could not find a working save point (${good.verdict}). ${good.tried.at(-1)?.reason ?? ""}`);
  const rec = await recover(c, good.found);
  return { dir, checkpoints, findGood: good, recover: rec };
}
