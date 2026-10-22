// The one-time license: signed offline, verified offline, never a secret, never a paywall on a restore.
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { activateLicense, FREE_PROJECT_LIMIT, licenseStatus, parseLicenseKey, removeLicense, signLicense } from "../src/license.ts";

function keys(): { pub: string; priv: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url"),
    priv: privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url"),
  };
}
const payload = { v: 1 as const, id: "cs_test_abcdefgh", plan: "web" as const, issued: "2026-10-22" };

describe("license keys", () => {
  test("a signed key verifies with the matching public key and carries only id, plan and date", () => {
    const k = keys();
    const key = signLicense(payload, k.priv);
    expect(key.startsWith("TM1.")).toBe(true);
    expect(parseLicenseKey(key, k.pub)).toEqual(payload);
    expect(key).not.toContain("@");
  });

  test("a key signed with another seller key, a tampered payload or junk is refused with a plain message", () => {
    const k = keys();
    const other = keys();
    const key = signLicense(payload, k.priv);
    expect(() => parseLicenseKey(key, other.pub)).toThrow(/signature does not match/);
    const [p, body, sig] = key.split(".") as [string, string, string];
    const tampered = Buffer.from(JSON.stringify({ ...payload, id: "cs_test_someoneelse" })).toString("base64url");
    expect(() => parseLicenseKey([p, tampered, sig].join("."), k.pub)).toThrow(/signature does not match/);
    expect(() => parseLicenseKey("hello", k.pub)).toThrow(/not a Time Machine license key/);
    expect(() => parseLicenseKey(`${p}.${Buffer.from("{").toString("base64url")}.${sig}`, k.pub)).toThrow(/damaged/);
    expect(() => parseLicenseKey(`${p}.${body}.${sig}x`, k.pub)).toThrow(/signature does not match/);
  });
});

describe("license on this computer", () => {
  test("activate saves under the store root, status reads it back, remove forgets it", () => {
    const k = keys();
    const home = mkdtempSync(join(tmpdir(), "tm-license-"));
    const ctx = { cwd: home, tmHome: home, env: {} };
    expect(licenseStatus(ctx, k.pub)).toEqual({ active: false, id: null, issued: null, problem: null, freeProjectLimit: FREE_PROJECT_LIMIT });
    const key = signLicense(payload, k.priv);
    expect(activateLicense(ctx, `  ${key}\n`, k.pub)).toMatchObject({ active: true, id: payload.id, issued: payload.issued, problem: null });
    const saved = JSON.parse(readFileSync(join(home, "license.json"), "utf8"));
    expect(saved).toEqual({ version: 1, key, activatedAt: expect.any(String) });
    expect(removeLicense(ctx).active).toBe(false);
    expect(licenseStatus(ctx, k.pub).active).toBe(false);
  });

  test("a bad key is refused before anything is written, and a damaged file reports a problem instead of counting", () => {
    const k = keys();
    const home = mkdtempSync(join(tmpdir(), "tm-license-"));
    const ctx = { cwd: home, tmHome: home, env: {} };
    expect(() => activateLicense(ctx, "TM1.nope.nope", k.pub)).toThrow();
    expect(licenseStatus(ctx, k.pub).active).toBe(false);
    writeFileSync(join(home, "license.json"), "{not json");
    expect(licenseStatus(ctx, k.pub)).toMatchObject({ active: false, problem: expect.stringContaining("damaged") });
    writeFileSync(join(home, "license.json"), JSON.stringify({ version: 1, key: signLicense(payload, keys().priv), activatedAt: "x" }));
    expect(licenseStatus(ctx, k.pub)).toMatchObject({ active: false, problem: expect.stringContaining("signature") });
  });
});
