import { audit } from "./audit.js";
import { TmError } from "./errors.js";
import { resolveProject } from "./project.js";
import { ensureStore, listIds } from "./store.js";
import type { Ctx, FindGoodResult } from "./types.js";
import { verify, type VerifyOptions } from "./verify.js";

/**
 * Walks back from the newest checkpoint and verifies each until one passes.
 * Aborting `signal` stops the running check and the search; the result says it was stopped.
 */
export async function findGood(ctx: Ctx, opts: VerifyOptions = {}): Promise<FindGoodResult> {
  const p = resolveProject(ctx);
  ensureStore(p);
  const ids = listIds(p);
  if (!ids.length) throw new TmError("not_found", "There are no checkpoints yet. Run tm checkpoint first.");
  const tried: FindGoodResult["tried"] = [];
  let result: FindGoodResult | null = null;
  for (const id of [...ids].reverse()) {
    const v = await verify(ctx, id, opts);
    if (v.stopped) {
      result = { verdict: "INCOMPLETE", found: null, tried, stopped: true };
      break;
    }
    tried.push({ id, verdict: v.verdict, reason: v.reason });
    if (v.verdict === "PASS") {
      result = { verdict: "PASS", found: id, tried };
      break;
    }
    if (v.verdict === "BLOCKED") {
      result = { verdict: "BLOCKED", found: null, tried };
      break;
    }
  }
  if (!result) {
    const allFailed = tried.length > 0 && tried.every((t) => t.verdict === "FAIL");
    result = { verdict: allFailed ? "FAIL" : "INCOMPLETE", found: null, tried };
  }
  audit(p, "find-good", result.found, result.stopped ? "stopped" : result.verdict);
  return result;
}
