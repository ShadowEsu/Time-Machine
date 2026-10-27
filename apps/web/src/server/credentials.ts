// API keys for the opt-in features. They are never written to projects.json or settings.json,
// never logged, and never sent to the window: the window only learns whether each one is set.
// A key comes from the environment first (GEMINI_API_KEY, ANTHROPIC_API_KEY, VERCEL_TOKEN), then
// from a file in the app's userData folder that holds it encrypted by macOS (Electron safeStorage).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as tm from "@timetm/core";
import { z } from "zod";
import { CredentialNameSchema, CredentialValueSchema, type CredentialName, type CredentialStatus } from "../shared/api.js";

const ENV_NAMES: Record<CredentialName, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", vercel: "VERCEL_TOKEN" };
const LABELS: Record<CredentialName, string> = { gemini: "Gemini API key", anthropic: "Anthropic API key", vercel: "Vercel token" };

/** The part of Electron's safeStorage this module uses. Tests pass a stand-in. */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const FileSchema = z.strictObject({
  version: z.literal(1),
  /** Base64 of the encrypted bytes, per key name. */
  entries: z.partialRecord(CredentialNameSchema, z.string().max(20_000)),
});
type CredentialsFile = z.infer<typeof FileSchema>;

export class Credentials {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
    private readonly env: Readonly<Record<string, string | undefined>>,
  ) {}

  private read(): CredentialsFile {
    const empty: CredentialsFile = { version: 1, entries: {} };
    if (!existsSync(this.path)) return empty;
    try {
      const r = FileSchema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (r.success) return r.data;
    } catch {
      // Falls through to setting the file aside.
    }
    renameSync(this.path, `${this.path}.broken-${Date.now()}`);
    return empty;
  }

  /** The key, or null when none is set. Only for the main process. */
  get(name: CredentialName): string | null {
    const fromEnv = CredentialValueSchema.safeParse(this.env[ENV_NAMES[name]]);
    if (fromEnv.success) return fromEnv.data;
    const stored = this.read().entries[name];
    if (!stored || !this.cipher.isEncryptionAvailable()) return null;
    try {
      const decrypted = CredentialValueSchema.safeParse(this.cipher.decryptString(Buffer.from(stored, "base64")));
      return decrypted.success ? decrypted.data : null;
    } catch {
      return null;
    }
  }

  /** Saves the key encrypted, or removes it when value is null. A key set in the environment still wins. */
  set(name: CredentialName, value: string | null): void {
    const file = this.read();
    if (value === null) {
      delete file.entries[name];
    } else {
      const parsed = CredentialValueSchema.safeParse(value);
      if (!parsed.success) throw new tm.TmError("usage", `The ${LABELS[name]} must have no spaces or line breaks.`);
      if (!this.cipher.isEncryptionAvailable()) {
        throw new tm.TmError("usage", `This Mac can't encrypt the ${LABELS[name]} right now, so it was not saved. You can set ${ENV_NAMES[name]} in the environment instead.`);
      }
      file.entries[name] = this.cipher.encryptString(parsed.data).toString("base64");
    }
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  /** Whether each key is set, and which one Ask uses: Gemini's when set, otherwise Anthropic's. This is all the window ever sees. */
  status(): CredentialStatus {
    const gemini = this.get("gemini") !== null;
    const anthropic = this.get("anthropic") !== null;
    return { gemini, anthropic, vercel: this.get("vercel") !== null, provider: gemini ? "gemini" : anthropic ? "anthropic" : null };
  }
}

/**
 * Reads KEY=VALUE lines from a development .env file. Only used when the app runs from a
 * source checkout. The values are passed to Credentials, never put into process.env, so
 * checks and hooks the app starts never inherit them.
 */
export function readDevEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m?.[1]) continue;
    const raw = m[2] ?? "";
    const q = raw[0];
    out[m[1]] = (q === '"' || q === "'") && raw.length >= 2 && raw.endsWith(q) ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, "");
  }
  return out;
}
