import { createHmac } from "node:crypto";

const PATTERNS: RegExp[] = [
  /sk_(live|test)_[A-Za-z0-9]{16,}/,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
];

export function looksSecret(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
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
