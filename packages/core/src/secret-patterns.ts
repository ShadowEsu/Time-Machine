// Text that looks like a secret. No Node imports, so the browser preview can use the same check.

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
  // A URL with a user and password, like postgres://app:pass@db.example.com/app.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/?#]+:[^\s@/?#]+@/i,
  // Env style lines with a secret sounding name, like DB_PASSWORD=... or export API_KEY=...
  /^\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?)[A-Z0-9_]*\s*[=:]\s*["']?[^\s"'$]{6,}/m,
];

export function looksSecret(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

/** Why a run note was refused. The engine and the browser preview say the same. */
export const NOTE_LOOKS_SECRET = "That note looks like it contains a secret, so it was not saved. Leave keys and passwords out of notes.";
