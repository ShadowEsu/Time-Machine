import { audit } from "./audit.js";
import { TmError } from "./errors.js";
import { resolveProject } from "./project.js";
import { ensureStore, listIds } from "./store.js";
import type { Ctx, FindGoodResult } from "./types.js";
import type { Verdict } from "./verdict.js";
import { verify, type VerifyOptions } from "./verify.js";

export interface FindGoodOptions extends VerifyOptions {
  /** Called before each check starts: the save point, its place in the walk (1 = newest) and how many there are. */
  onTry?: (id: string, n: number, of: number) => void;
  /** Called once a check's result is recorded (never for a stopped check), in the walk's order: the save point and its verdict. */
  onResult?: (id: string, verdict: Verdict) => void;
}

/** A listener is for display only: one that throws never ends the search early or loses its find-good audit line. */
function tell(fn: () => void): void {
  try {
    fn();
  } catch {
    // Display only.
  }
}

/**
 * Walks back from the newest checkpoint and verifies each until one passes.
 * Aborting `signal` stops the running check and the search; the result says it was stopped.
 */
export async function findGood(ctx: Ctx, opts: FindGoodOptions = {}): Promise<FindGoodResult> {
  const p = resolveProject(ctx);
  ensureStore(p);
  const ids = listIds(p);
  if (!ids.length) throw new TmError("not_found", "There are no checkpoints yet. Run tm checkpoint first.");
  const tried: FindGoodResult["tried"] = [];
  let result: FindGoodResult | null = null;
  const { onTry, onResult, ...verifyOpts } = opts;
  for (const [i, id] of [...ids].reverse().entries()) {
    tell(() => onTry?.(id, i + 1, ids.length));
    const v = await verify(ctx, id, verifyOpts);
    if (v.stopped) {
      result = { verdict: "INCOMPLETE", found: null, tried, stopped: true };
      break;
    }
    tried.push({ id, verdict: v.verdict, reason: v.reason });
    tell(() => onResult?.(id, v.verdict));
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
