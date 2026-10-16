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
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\b(rk|pk)_live_[A-Za-z0-9]{16,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  // Env style lines with a secret sounding name, like DB_PASSWORD=... or export API_KEY=...
  /^\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?)[A-Z0-9_]*\s*[=:]\s*["']?[^\s"'$]{6,}/m,
];

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

export function looksSecret(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

/** Free text (a prompt, a command) made safe to store: one line, clipped, hidden when it looks like a secret. */
export function clipSafe(text: string, n: number, hidden = "(text hidden: it looked like it contained a secret)"): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (looksSecret(text) || looksSecret(one)) return hidden;
  return one.length > n ? `${one.slice(0, n - 3)}...` : one;
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
