import { loadConfig } from "./config.js";
import { TmError } from "./errors.js";
import { configRoot, resolveProject } from "./project.js";
import { looksSecret, redact } from "./secrets.js";
import type { Ctx, VerdictRecord } from "./types.js";
import { validVerdictsFor } from "./verdicts.js";
import { secretValues } from "./verify.js";

const UNREADABLE = "That save point's check record couldn't be read.";

/**
 * The newest sealed check record of one save point, or null when it has none. Read only; nothing here is ever sent anywhere.
 * Only records whose seal and manifest still hold come back (validVerdictsFor), and only this id's. The command and the
 * reason are cleaned with today's .env values, since one may be newer than the record, and hidden when they look secret.
 * `log` is the record's label only: nothing here opens or reads it.
 */
export function checkRecord(ctx: Ctx, id: string): VerdictRecord | null {
  if (!/^cp-\d{4,}$/.test(id)) throw new TmError("usage", "That is not a save point id.");
  const p = resolveProject(ctx);
  try {
    const record = validVerdictsFor(p, id).at(-1);
    if (!record) return null;
    const secrets = secretValues([p.root], loadConfig(configRoot(p)).config);
    const clean = (text: string, what: string): string => {
      const cleaned = redact(text, secrets);
      return looksSecret(text) || looksSecret(cleaned) ? `(${what} hidden: it looked like it contained a secret)` : cleaned;
    };
    return { ...record, command: clean(record.command, "command"), reason: clean(record.reason, "reason") };
  } catch {
    // The store or the config could not be read: say so without anything from inside them.
    throw new TmError("not_found", UNREADABLE);
  }
}
