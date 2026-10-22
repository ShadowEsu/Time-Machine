// The one-time license for the web app. A key is a signed statement that one purchase happened.
// It holds no name, email or secret: only an id, the plan and the issue date. Verification is
// offline with the public key below, so the app never phones home. The CLI needs no license, and
// a restore is never blocked by one: the free web app is limited only in how many projects it lists.
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { TmError } from "./errors.js";
import type { Ctx } from "./types.js";

/** Raw Ed25519 public key, base64url. The matching private key lives only with the seller. */
export const LICENSE_PUBLIC_KEY = "Q_PPODTar9QhyhsdEruxYVIpPl-kSZnrfTQtcAzHqoA";
/** Projects the free web app lists at once. Everything else, including every restore, is free. */
export const FREE_PROJECT_LIMIT = 3;
const PREFIX = "TM1";
const FILE = "license.json";
const ED25519_SPKI_HEADER = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_PKCS8_HEADER = Buffer.from("302e020100300506032b657004220420", "hex");

const PayloadSchema = z.strictObject({
  v: z.literal(1),
  /** Opaque purchase id, 8 to 64 safe characters. Never an email or a name. */
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  plan: z.literal("web"),
  /** Issue date, YYYY-MM-DD. */
  issued: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type LicensePayload = z.infer<typeof PayloadSchema>;

export interface LicenseStatus {
  active: boolean;
  id: string | null;
  issued: string | null;
  /** Why a stored key no longer counts, or null. */
  problem: string | null;
  freeProjectLimit: number;
}

function b64(buf: Buffer): string {
  return buf.toString("base64url");
}
function unb64(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

/** Signs a payload with the seller's raw Ed25519 private key (base64url, 32 bytes). Used by the checkout service and by tests. */
export function signLicense(payload: LicensePayload, privateKey: string): string {
  const parsed = PayloadSchema.parse(payload);
  const raw = unb64(privateKey);
  if (raw.length !== 32) throw new TmError("usage", "The license signing key must be 32 raw Ed25519 bytes, base64url.");
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_HEADER, raw]), format: "der", type: "pkcs8" });
  const body = Buffer.from(JSON.stringify(parsed));
  return [PREFIX, b64(body), b64(cryptoSign(null, body, key))].join(".");
}

/** Checks a key's shape and signature. Throws a usage error that says what is wrong. */
export function parseLicenseKey(key: string, publicKey: string = LICENSE_PUBLIC_KEY): LicensePayload {
  const text = key.trim();
  const parts = text.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) throw new TmError("usage", "That is not a Time Machine license key. A key starts with TM1 and has three parts separated by dots.");
  let payload: unknown;
  try {
    payload = JSON.parse(unb64(parts[1]).toString("utf8"));
  } catch {
    throw new TmError("usage", "The license key is damaged. Copy it again from your purchase page.");
  }
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) throw new TmError("usage", "The license key is damaged. Copy it again from your purchase page.");
  const pub = createPublicKey({ key: Buffer.concat([ED25519_SPKI_HEADER, unb64(publicKey)]), format: "der", type: "spki" });
  if (!cryptoVerify(null, unb64(parts[1]), pub, unb64(parts[2]))) throw new TmError("usage", "The license key's signature does not match. Copy it again from your purchase page.");
  return parsed.data;
}

function homeDir(ctx: Ctx): string {
  const env = ctx.env ?? process.env;
  return resolve(ctx.cwd, ctx.tmHome ?? env.TM_HOME ?? join(homedir(), ".timemachine"));
}

const FileSchema = z.strictObject({ version: z.literal(1), key: z.string().max(4000), activatedAt: z.string() });

/** The license on this computer. Reads only; never creates the store. */
export function licenseStatus(ctx: Ctx, publicKey: string = LICENSE_PUBLIC_KEY): LicenseStatus {
  const none: LicenseStatus = { active: false, id: null, issued: null, problem: null, freeProjectLimit: FREE_PROJECT_LIMIT };
  let text: string;
  try {
    text = readFileSync(join(homeDir(ctx), FILE), "utf8");
  } catch {
    return none;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const file = FileSchema.safeParse(raw);
  if (!file.success) return { ...none, problem: "The saved license file is damaged. Enter your key again." };
  try {
    const p = parseLicenseKey(file.data.key, publicKey);
    return { active: true, id: p.id, issued: p.issued, problem: null, freeProjectLimit: FREE_PROJECT_LIMIT };
  } catch (e) {
    return { ...none, problem: e instanceof Error ? e.message : String(e) };
  }
}

/** Verifies the key, then saves it under the store root for every project on this computer. */
export function activateLicense(ctx: Ctx, key: string, publicKey: string = LICENSE_PUBLIC_KEY): LicenseStatus {
  parseLicenseKey(key, publicKey);
  const home = homeDir(ctx);
  mkdirSync(home, { recursive: true });
  const path = join(home, FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, key: key.trim(), activatedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  return licenseStatus(ctx, publicKey);
}

/** Forgets the saved key. Save points and recovery are untouched. */
export function removeLicense(ctx: Ctx): LicenseStatus {
  rmSync(join(homeDir(ctx), FILE), { force: true });
  return licenseStatus(ctx);
}
