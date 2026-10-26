import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { TmError } from "./errors.js";
import { configRoot, resolveProject } from "./project.js";
import { looksSecret, redact, UNSAFE_CHARS } from "./secrets.js";
import type { Ctx } from "./types.js";
import { secretValues } from "./verify.js";

/** The end of a check's stored log, cleaned to be shown. Read only; nothing here is ever sent anywhere. */
export interface LogTail {
  /** The log's local path, which the app already shows. */
  log: string;
  /** The last lines: escapes and control characters removed, each clipped, secrets redacted or the line hidden. */
  lines: string[];
  /** The log's end holds bytes that are not text, so none of it is shown. */
  binary: boolean;
  /** The log's end looked like it held a private key or another secret over several lines, so none of it is shown. */
  hidden: boolean;
}

/** At most this much of the log's end is read, however large the log is. */
export const TAIL_READ_BYTES = 64 * 1024;
const MAX_LINES = 20;
const MAX_LINE_CHARS = 300;
const MAX_TOTAL_BYTES = 4096;
const HIDDEN_LINE = "(line hidden: it looked like it contained a secret)";
// Terminal escapes: CSI sequences (colours, cursor moves) and OSC sequences (titles, links).
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const PRIVATE_KEY = /-----(?:BEGIN|END) [A-Z ]*PRIVATE KEY-----/;
const UNREADABLE = "That log couldn't be read.";

/**
 * The last lines of the newest stored log of one save point's check, or null when it has none.
 * The log is picked by the exact name the check writes (`<id>-<stamp>.log`), never followed through a link,
 * and only its last 64 KB are read. Today's .env values are redacted again, since one may be newer than the log.
 */
export function checkLogTail(ctx: Ctx, id: string): LogTail | null {
  if (!/^cp-\d{4,}$/.test(id)) throw new TmError("usage", "That is not a save point id.");
  const p = resolveProject(ctx);
  const dir = join(p.store, "logs");
  let names: string[];
  try {
    if (!lstatSync(dir).isDirectory()) return null;
    names = readdirSync(dir);
  } catch {
    return null;
  }
  // The stamp() format; ISO stamps sort by name, so the last is the newest.
  const exact = new RegExp(`^${id}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z\\.log$`);
  const name = names.filter((n) => exact.test(n)).sort().at(-1);
  if (!name) return null;
  const log = join(dir, name);
  const { buf, partial } = readTail(log);
  // Any NUL in the read means it is not text (isBinary looks only at the first 8000 bytes; the tail is checked whole).
  if (buf.includes(0)) return { log, lines: [], binary: true, hidden: false };

  let text = buf.toString("utf8");
  // A read that starts inside the log starts inside a line: drop that partial line.
  if (partial) text = text.slice(text.indexOf("\n") + 1);
  if (PRIVATE_KEY.test(text)) return { log, lines: [], binary: false, hidden: true };
  const raw = text.split(/\r?\n/);
  while (raw.length && !raw.at(-1)?.trim()) raw.pop();
  const secrets = secretValues([p.root], loadConfig(configRoot(p)).config);
  const lines = raw.slice(-MAX_LINES).map((line) => {
    const clean = redact(line.replace(ANSI, "").replace(/\t/g, "  ").replace(UNSAFE_CHARS, ""), secrets);
    if (looksSecret(line) || looksSecret(clean)) return HIDDEN_LINE;
    const chars = Array.from(clean);
    return chars.length > MAX_LINE_CHARS ? `${chars.slice(0, MAX_LINE_CHARS - 3).join("")}...` : clean;
  });
  while (lines.length && Buffer.byteLength(lines.join("\n")) > MAX_TOTAL_BYTES) lines.shift();
  while (lines.length && !lines[0]?.trim()) lines.shift();
  // A secret split over lines (a key's body, a wrapped token) shows only when the lines are joined.
  if (looksSecret(lines.join("\n"))) return { log, lines: [], binary: false, hidden: true };
  return { log, lines, binary: false, hidden: false };
}

/** One positioned read of the file's end. Only a regular file, opened without following a link. */
function readTail(path: string): { buf: Buffer; partial: boolean } {
  let fd: number;
  try {
    if (!lstatSync(path).isFile()) throw new Error("not a file");
    // O_NONBLOCK: a pipe swapped in under the log's name after the lstat opens at once (and fstat refuses it) instead of
    // waiting forever for a writer. It changes nothing for a regular file.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new TmError("not_found", UNREADABLE);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new TmError("not_found", UNREADABLE);
    const len = Math.min(st.size, TAIL_READ_BYTES);
    const buf = Buffer.alloc(len);
    const n = readSync(fd, buf, 0, len, st.size - len);
    return { buf: buf.subarray(0, n), partial: st.size > len };
  } catch (e) {
    if (e instanceof TmError) throw e;
    throw new TmError("not_found", UNREADABLE);
  } finally {
    closeSync(fd);
  }
}
