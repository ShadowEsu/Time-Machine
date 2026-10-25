import { createHmac } from "node:crypto";
import { looksSecret } from "./secret-patterns.js";

export { looksSecret };

const SECRET_FILE_NAMES: RegExp[] = [
  /^\.env(\..+)?$/,
  /^\.(npmrc|pypirc|netrc|git-credentials)$/,
  /^id_(rsa|dsa|ecdsa|ed25519)$/,
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/,
  /^(credentials|service-account.*)\.json$/,
];
const SAFE_EXAMPLES = /^\.env\.(example|sample|template|dist)$/;

/** Files that hold secrets by convention. They are never saved, whatever they contain. */
export function isSecretFileName(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return !SAFE_EXAMPLES.test(base) && SECRET_FILE_NAMES.some((r) => r.test(base));
}

// C0/C1 controls (terminal escapes, NUL, BEL) and bidi controls that could restyle or reorder shown text.
export const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Free text (a prompt, a command) made safe to store and show: one line, no control characters, clipped, hidden when it looks like a secret. */
export function clipSafe(text: string, n: number, hidden = "(text hidden: it looked like it contained a secret)"): string {
  const one = text.replace(/\s+/g, " ").replace(UNSAFE_CHARS, "").trim();
  if (looksSecret(text) || looksSecret(one)) return hidden;
  // Count code points, so an emoji is never cut in half.
  const chars = Array.from(one);
  return chars.length > n ? `${chars.slice(0, n - 3).join("")}...` : one;
}

/** True when the text holds any of the given secret values. Short values are ignored, as in redact. */
export function holdsSecretValue(text: string, values: string[]): boolean {
  return values.some((v) => v.length >= 4 && text.includes(v));
}

export function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

export interface EnvLine {
  name: string;
  value: string;
}

/** Parses KEY=VALUE lines. Supports `export`, quotes and comments. */
export function parseDotenv(text: string): EnvLine[] {
  const out: EnvLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(raw);
    if (!m || m[1] === undefined) continue;
    let value = (m[2] ?? "").trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.endsWith(q) && value.length >= 2) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out.push({ name: m[1], value });
  }
  return out;
}

/** A keyed fingerprint: detects that a value changed without storing it. */
export function fingerprint(key: Buffer, name: string, value: string): string {
  return createHmac("sha256", key).update(`${name}\0${value}`).digest("hex").slice(0, 16);
}

export function redact(text: string, values: string[]): string {
  let out = text;
  for (const v of values) if (v.length >= 4) out = out.split(v).join("[redacted]");
  return out;
}
